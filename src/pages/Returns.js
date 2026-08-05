import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { getCachedProducts } from '../utils/catalogCache';
import { cashBalanceTotalByCurrency, formatDisplayAmount, formatInsufficientLedgerMessage } from '../utils/currencyFormat';
import SortableTh from '../components/SortableTh';
import CustomerSearchableSelect from '../components/CustomerSearchableSelect';
import ProductCatalogFilterFields from '../components/ProductCatalogFilterFields';
import FormSearchableSelect from '../components/FormSearchableSelect';
import { matchesProductCatalogFilters, getCascadedFilterOptions, getCascadedDateOptions } from '../utils/productFilterUtils';
import { useClientTableSort, compareForSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import {
  computeReturnRefundDue,
  computeReturnRefundMeta,
  buildReturnRefundRequest,
  buildReturnCrossCurrencyConfirmMessage,
  buildReturnCombinedRefundConfirmMessage,
} from '../utils/returnRefundHelpers';
import { uzsToUsd, usdToUzs, saleEffectiveUnitPrice } from '../utils/saleCompletePayHelpers';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime } from '../utils/localeFormat';
import i18n from '../i18n';
import './TablePage.css';
import AmountInput from '../components/AmountInput';

const PRODUCT_CATEGORY_TYPE_VALUES = ['sports', 'casual'];

function returnProductPickerLabel(p, tr) {
  if (!p) return '';
  return tr('productPicker', { brand: p.brand, model: p.model, size: p.size, color: p.color });
}

function getSaleUnitPrice(sale) {
  if (!sale || sale.selling_price == null || sale.selling_price === '') return NaN;
  return saleEffectiveUnitPrice(sale);
}

function getSaleCurrency(sale) {
  return sale?.sale_currency || 'USD';
}

function formatAutoSoldPrice(unitPrice, quantity, currency) {
  const qty = parseInt(quantity, 10) || 0;
  if (!Number.isFinite(unitPrice) || qty <= 0) return '';
  const total = unitPrice * qty;
  return currency === 'UZS' ? String(Math.round(total)) : total.toFixed(2);
}

function formatSoldPriceForApi(amount, currency) {
  const ccy = String(currency || 'USD').toUpperCase();
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return ccy === 'UZS' ? String(Math.round(n)) : n.toFixed(2);
}

function extractReturnApiError(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail;
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  for (const key of ['sold_price', 'sold_price_currency', 'sale', 'quantity', 'product', 'notes']) {
    const val = data[key];
    if (Array.isArray(val) && val[0]) return String(val[0]);
    if (typeof val === 'string' && val.trim()) return val;
  }
  return null;
}

function computeReturnDue(returnItem) {
  const sale = returnItem?.sale_detail;
  const qty = parseInt(returnItem?.quantity, 10) || 0;
  if (!sale || qty <= 0) {
    return { amount: null, currency: 'USD', unitPrice: NaN };
  }
  const currency = getSaleCurrency(sale);
  const unitPrice = getSaleUnitPrice(sale);
  if (!Number.isFinite(unitPrice)) {
    return { amount: null, currency, unitPrice: NaN };
  }
  const raw = unitPrice * qty;
  const amount = currency === 'UZS' ? Math.round(raw) : parseFloat(raw.toFixed(2));
  return { amount, currency, unitPrice };
}

function computeFormReturnDue(sale, quantity) {
  if (!sale) return { amount: null, currency: 'USD', unitPrice: NaN };
  return computeReturnDue({ sale_detail: sale, quantity });
}

function refundAmountExceedsDue(refundAmount, refundCurrency, due) {
  if (due.amount == null || !Number.isFinite(due.amount)) return false;
  const refundCcy = String(refundCurrency || 'USD').toUpperCase();
  const dueCcy = String(due.currency || 'USD').toUpperCase();
  if (refundCcy !== dueCcy) return false;
  const refund = parseFloat(refundAmount);
  if (!Number.isFinite(refund)) return false;
  const tol = refundCcy === 'UZS' ? 0.5 : 0.01;
  return refund > due.amount + tol;
}

function formatRefundAmounts(uzs, usd) {
  const parts = [];
  if (uzs > 0) parts.push(formatDisplayAmount(uzs, 'UZS'));
  if (usd > 0) parts.push(formatDisplayAmount(usd, 'USD'));
  return parts.length ? parts.join(' + ') : '—';
}

/** @returns {false} if user cancels */
function confirmReturnRefund(returnItem, uzsEntered, usdEntered, meta) {
  const tr = (key, opts) => i18n.t(key, { ns: 'returns', ...opts });
  const uzs = Number(uzsEntered) || 0;
  const usd = Number(usdEntered) || 0;
  const due = meta
    ? { amount: meta.due, currency: meta.sc, unitPrice: computeReturnRefundDue(returnItem).unitPrice }
    : computeReturnRefundDue(returnItem);
  const productLabel = returnItem?.product_detail
    ? tr('confirm.productLine', {
        label: `${returnItem.product_detail.brand} ${returnItem.product_detail.model}`,
      })
    : tr('confirm.productFallback', { id: returnItem?.product ?? '?' });
  const customerLine = returnItem?.customer_detail?.name
    ? `\n${tr('confirm.customerLine', { name: returnItem.customer_detail.name })}`
    : '';
  const dueLine =
    due.amount != null
      ? formatDisplayAmount(due.amount, due.currency)
      : '—';
  const unitDetail = Number.isFinite(due.unitPrice)
    ? tr('confirm.unitDetail', {
        unit: formatDisplayAmount(due.unitPrice, due.currency),
        qty: returnItem?.quantity ?? 0,
      })
    : '';

  const msg = [
    tr('confirm.markRefundedTitle', { id: returnItem?.id ?? '?' }),
    '',
    productLabel,
    tr('confirm.qtyLine', { qty: returnItem?.quantity ?? '—' }) + customerLine,
    '',
    tr('confirm.soldPriceLine', { amount: dueLine, unitDetail }),
    tr('confirm.refundingLine', { amounts: formatRefundAmounts(uzs, usd) }),
    '',
    tr('confirm.proceed'),
  ].join('\n');

  return window.confirm(msg);
}

/** Pending refunds first; refunded rows sink to the bottom. */
function compareNotRefundedFirst(a, b) {
  const aDone = a.refund_status === 'refunded' ? 1 : 0;
  const bDone = b.refund_status === 'refunded' ? 1 : 0;
  return aDone - bDone;
}

const RETURNS_SORT_ACCESSORS = {
  id: (r) => Number(r.id) || 0,
  category_type: (r) => String(r.product_detail?.category_type ?? '').toLowerCase(),
  category: (r) => String(r.product_detail?.category ?? '').toLowerCase(),
  product: (r) =>
    r.product_detail
      ? `${r.product_detail.brand} ${r.product_detail.model}`.toLowerCase()
      : String(r.product ?? ''),
  brand: (r) => String(r.product_detail?.brand ?? '').toLowerCase(),
  model: (r) => String(r.product_detail?.model ?? '').toLowerCase(),
  size: (r) => String(r.product_detail?.size ?? '').toLowerCase(),
  color: (r) => String(r.product_detail?.color ?? '').toLowerCase(),
  sale: (r) => Number(r.sale) || 0,
  customer: (r) => String(r.customer_detail?.name ?? '').toLowerCase(),
  phone: (r) => String(r.customer_detail?.telephone ?? '').toLowerCase(),
  quantity: (r) => Number(r.quantity) || 0,
  reason: (r) => String(r.reason ?? '').toLowerCase(),
  refund_uzs: (r) =>
    (parseFloat(r.refund_uzs_cash) || 0) + (parseFloat(r.refund_uzs_card) || 0),
  refund_usd: (r) =>
    (parseFloat(r.refund_usd_cash) || 0) + (parseFloat(r.refund_usd_card) || 0),
  refund_status: (r) => String(r.refund_status ?? '').toLowerCase(),
  notes: (r) => String(r.notes ?? '').toLowerCase(),
  processed_by: (r) => String(r.processed_by_detail?.username ?? '').toLowerCase(),
  return_date: (r) => new Date(r.return_date).getTime() || 0,
};

const Returns = () => {
  const { t, monthOptions } = useAppTranslation(['returns', 'common', 'status', 'products']);
  const categoryTypeLabel = (value) =>
    value ? t(`categoryTypes.${value}`, { defaultValue: value }) : '';
  const { hasPermission } = usePermissions();
  const canMarkRefunded = hasPermission('returns.mark_refunded');
  const canCreateReturn = hasPermission('returns.create');
  const [returns, setReturns] = useState([]);
  const [filteredReturns, setFilteredReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState({ message: '', type: '', visible: false });

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type, visible: true });
    setTimeout(() => setNotification({ message: '', type: '', visible: false }), 4000);
  };
  const [showForm, setShowForm] = useState(false);
  const [formCategory, setFormCategory] = useState('');
  const [filters, setFilters] = useState({
    category_type: '',
    category: [],
    brand: [],
    model: [],
    sizes: [],
    color: [],
    reason: '',
    year: '',
    month: '',
  });
  const [formData, setFormData] = useState({
    product: '',
    sale: '',
    customer: '',
    quantity: '',
    sold_price: '',
    sold_price_currency: 'USD',
    reason: 'customer_request',
    notes: '',
  });
  const [refundFormData, setRefundFormData] = useState({
    returnId: null,
    uzs: '',
    usd: '',
  });
  const [showRefundForm, setShowRefundForm] = useState(false);
  /** When true, sale/qty changes do not overwrite the refund amount field. */
  const [refundAmountTouched, setRefundAmountTouched] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateError, setExchangeRateError] = useState(null);

  const productDropdownRef = useRef(null);
  const [productSearch, setProductSearch] = useState('');
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  useEffect(() => {
    if (!showForm) {
      setProductSearch('');
      setProductDropdownOpen(false);
      setRefundAmountTouched(false);
    }
  }, [showForm]);

  useEffect(() => {
    if (!productDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target)) {
        setProductDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [productDropdownOpen]);

  useEffect(() => {
    fetchReturns();
    fetchProducts();
    fetchSales();
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showRefundForm && !showForm) {
      setExchangeRate(null);
      setExchangeRateError(null);
      return;
    }
    let cancelled = false;
    api
      .get('/exchange-rate/')
      .then((res) => {
        if (!cancelled) {
          setExchangeRate(res.data);
          setExchangeRateError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExchangeRate(null);
          setExchangeRateError(t('notifications.exchangeRateFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showRefundForm, showForm, t]);

  const refundReturnItem = useMemo(
    () => (refundFormData.returnId ? returns.find((r) => r.id === refundFormData.returnId) : null),
    [returns, refundFormData.returnId],
  );

  const cbuRate = exchangeRate?.rate ?? null;
  const refundMeta = useMemo(
    () => computeReturnRefundMeta(refundReturnItem, refundFormData, cbuRate),
    [refundReturnItem, refundFormData, cbuRate],
  );

  const fetchReturns = async () => {
    try {
      const response = await apiGetAll('/returns/');
      const returnsList = response.data.results || response.data;
      setReturns(returnsList);
      applyFilters(returnsList);
    } catch (error) {
      console.error('Error fetching returns:', error);
    } finally {
      setLoading(false);
    }
  };



  const applyFilters = (returnsList) => {
    let filtered = returnsList;
    
    if (filters.category_type) {
      filtered = filtered.filter(
        (returnItem) => returnItem.product_detail?.category_type === filters.category_type,
      );
    }
    filtered = filtered.filter((returnItem) =>
      matchesProductCatalogFilters(returnItem.product_detail, filters),
    );
    if (filters.reason) {
      filtered = filtered.filter(returnItem => returnItem.reason === filters.reason);
    }
    if (filters.year) {
      filtered = filtered.filter(returnItem => {
        const returnYear = new Date(returnItem.return_date).getFullYear();
        return returnYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(returnItem => {
        const returnMonth = new Date(returnItem.return_date).getMonth() + 1;
        return returnMonth.toString() === filters.month;
      });
    }
    
    setFilteredReturns(filtered);
  };

  useEffect(() => {
    if (returns.length > 0) {
      applyFilters(returns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const returnColumnTotals = useMemo(() => {
    let quantity = 0;
    let uzs = 0;
    let usd = 0;
    for (const r of filteredReturns) {
      quantity += parseInt(r.quantity, 10) || 0;
      uzs += (parseFloat(r.refund_uzs_cash) || 0) + (parseFloat(r.refund_uzs_card) || 0);
      usd += (parseFloat(r.refund_usd_cash) || 0) + (parseFloat(r.refund_usd_card) || 0);
    }
    return { quantity, uzs, usd };
  }, [filteredReturns]);

  /** Units already tied to return rows per sale (any refund status) — prevents over-returning the same sale line. */
  const qtyReturnedBySaleId = useMemo(() => {
    const m = new Map();
    for (const r of returns) {
      let sid = r.sale;
      if (sid == null || sid === '') continue;
      if (typeof sid === 'object' && sid !== null) sid = sid.id;
      sid = Number(sid);
      if (!Number.isFinite(sid)) continue;
      const q = parseInt(r.quantity, 10) || 0;
      m.set(sid, (m.get(sid) || 0) + q);
    }
    return m;
  }, [returns]);

  const getRemainingReturnQtyForSale = useCallback(
    (sale) => {
      if (!sale?.id) return 0;
      const used = qtyReturnedBySaleId.get(sale.id) || 0;
      return Math.max(0, (parseInt(sale.quantity, 10) || 0) - used);
    },
    [qtyReturnedBySaleId]
  );

  const selectedSaleForReturn = useMemo(() => {
    if (!formData.sale) return null;
    const id = parseInt(formData.sale, 10);
    if (!Number.isFinite(id)) return null;
    return sales.find((s) => s.id === id) || null;
  }, [formData.sale, sales]);

  const returnableSales = useMemo(
    () =>
      sales.filter(
        (s) => s.status === 'completed' && getRemainingReturnQtyForSale(s) > 0,
      ),
    [sales, getRemainingReturnQtyForSale],
  );

  const newReturnEligibleSales = useMemo(() => {
    const cid = formData.customer ? parseInt(formData.customer, 10) : null;
    const pid = formData.product ? parseInt(formData.product, 10) : null;
    return returnableSales.filter((s) => {
      if (cid != null && !Number.isNaN(cid) && s.customer !== cid) return false;
      if (pid != null && !Number.isNaN(pid) && s.product !== pid) return false;
      if (formCategory && s.product_detail?.category !== formCategory) return false;
      return true;
    });
  }, [returnableSales, formData.customer, formData.product, formCategory]);

  const newReturnFormCustomerIds = useMemo(() => {
    const pid = formData.product ? parseInt(formData.product, 10) : null;
    const ids = new Set();
    for (const s of returnableSales) {
      if (formCategory && s.product_detail?.category !== formCategory) continue;
      if (pid != null && !Number.isNaN(pid) && s.product !== pid) continue;
      if (s.customer) ids.add(s.customer);
    }
    return ids;
  }, [returnableSales, formCategory, formData.product]);

  const newReturnFormCustomers = useMemo(
    () => customers.filter((c) => newReturnFormCustomerIds.has(c.id)),
    [customers, newReturnFormCustomerIds],
  );

  const newReturnFormProducts = useMemo(() => {
    const cid = formData.customer ? parseInt(formData.customer, 10) : null;
    const productIds = new Set();
    for (const s of returnableSales) {
      if (cid != null && !Number.isNaN(cid) && s.customer !== cid) continue;
      if (formCategory && s.product_detail?.category !== formCategory) continue;
      if (s.product) productIds.add(s.product);
    }
    return products.filter((p) => productIds.has(p.id));
  }, [returnableSales, products, formData.customer, formCategory]);

  const newReturnFormCategories = useMemo(() => {
    const cid = formData.customer ? parseInt(formData.customer, 10) : null;
    const pid = formData.product ? parseInt(formData.product, 10) : null;
    const cats = new Set();
    for (const s of returnableSales) {
      if (cid != null && !Number.isNaN(cid) && s.customer !== cid) continue;
      if (pid != null && !Number.isNaN(pid) && s.product !== pid) continue;
      const cat = s.product_detail?.category;
      if (cat) cats.add(cat);
    }
    return [...cats].sort();
  }, [returnableSales, formData.customer, formData.product]);

  const pruneNewReturnForm = useCallback(
    (patch, categoryValue = formCategory) => {
      const merged = { ...formData, ...patch };
      const cid = merged.customer ? parseInt(merged.customer, 10) : null;
      const pid = merged.product ? parseInt(merged.product, 10) : null;
      const matches = returnableSales.filter((s) => {
        if (cid != null && !Number.isNaN(cid) && s.customer !== cid) return false;
        if (pid != null && !Number.isNaN(pid) && s.product !== pid) return false;
        if (categoryValue && s.product_detail?.category !== categoryValue) return false;
        return true;
      });
      let customer = merged.customer;
      let product = merged.product;
      let sale = merged.sale;
      if (customer && !matches.some((s) => s.customer === cid)) customer = '';
      if (product && !matches.some((s) => s.product === pid)) product = '';
      if (sale && !matches.some((s) => s.id === parseInt(sale, 10))) sale = '';
      const pricingCleared = sale
        ? {}
        : { sold_price: '', sold_price_currency: 'USD' };
      return { ...merged, customer, product, sale, ...pricingCleared };
    },
    [formData, formCategory, returnableSales],
  );

  useEffect(() => {
    if (!showForm) return;
    if (formCategory && !newReturnFormCategories.includes(formCategory)) {
      setFormCategory('');
    }
    const cid = formData.customer ? parseInt(formData.customer, 10) : null;
    if (formData.customer && (Number.isNaN(cid) || !newReturnFormCustomerIds.has(cid))) {
      setFormData((prev) => pruneNewReturnForm({ ...prev, customer: '', sale: '' }));
    }
    const pid = formData.product ? parseInt(formData.product, 10) : null;
    if (
      formData.product &&
      (Number.isNaN(pid) || !newReturnFormProducts.some((p) => p.id === pid))
    ) {
      setFormData((prev) => pruneNewReturnForm({ ...prev, product: '', sale: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showForm,
    formCategory,
    newReturnFormCategories,
    newReturnFormCustomerIds,
    newReturnFormProducts,
    formData.customer,
    formData.product,
  ]);

  const resolveSaleForPricing = useCallback(() => {
    if (selectedSaleForReturn) return selectedSaleForReturn;
    if (formData.product && newReturnEligibleSales.length === 1) {
      return newReturnEligibleSales[0];
    }
    return null;
  }, [selectedSaleForReturn, formData.product, newReturnEligibleSales]);

  const applySuggestedRefundAmount = useCallback((sale, quantity) => {
    if (!sale) return {};
    const currency = getSaleCurrency(sale);
    const unitPrice = getSaleUnitPrice(sale);
    const autoTotal = formatAutoSoldPrice(unitPrice, quantity, currency);
    if (!autoTotal) return { sold_price_currency: currency };
    return {
      sold_price: autoTotal,
      sold_price_currency: currency,
    };
  }, []);

  const mergeSuggestedRefund = useCallback(
    (patch, sale, quantity) => {
      if (refundAmountTouched) return patch;
      return { ...patch, ...applySuggestedRefundAmount(sale, quantity) };
    },
    [refundAmountTouched, applySuggestedRefundAmount],
  );

  const formReturnDue = useMemo(() => {
    const sale = resolveSaleForPricing();
    return computeFormReturnDue(sale, formData.quantity);
  }, [resolveSaleForPricing, formData.quantity]);

  const refundAmountOverDue = useMemo(
    () => refundAmountExceedsDue(formData.sold_price, formData.sold_price_currency, formReturnDue),
    [formData.sold_price, formData.sold_price_currency, formReturnDue],
  );

  const fetchProducts = async () => {
    try {
      const list = await getCachedProducts(api);
      setProducts(list);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchSales = async () => {
    try {
      const response = await apiGetAll('/sales/');
      setSales(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching sales:', error);
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await apiGetAll('/customers/', { params: { lite: 1 } });
      setCustomers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    if (!formData.sale) {
      showNotification(t('notifications.selectSale'), 'error');
      return;
    }
    if (formData.reason === 'other' && !String(formData.notes || '').trim()) {
      showNotification(t('notifications.notesRequiredOther'), 'error');
      return;
    }
    const qty = parseInt(formData.quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      showNotification(t('notifications.invalidQuantity'), 'error');
      return;
    }
    const refundTotal = parseFloat(String(formData.sold_price ?? '').trim());
    if (!Number.isFinite(refundTotal) || refundTotal <= 0) {
      showNotification(t('notifications.invalidRefundGreaterZero'), 'error');
      return;
    }
    const refundAmountApi = formatSoldPriceForApi(refundTotal, formData.sold_price_currency);
    if (!refundAmountApi) {
      showNotification(t('notifications.invalidRefund'), 'error');
      return;
    }
    if (refundAmountOverDue) {
      showNotification(
        t('notifications.refundExceedsDue', {
          refund: formatDisplayAmount(parseFloat(formData.sold_price), formData.sold_price_currency),
          due: formatDisplayAmount(formReturnDue.amount, formReturnDue.currency),
        }),
        'error',
      );
      return;
    }
    if (formData.sale) {
      const selectedSale = sales.find((s) => s.id === parseInt(formData.sale, 10));
      if (selectedSale) {
        if (selectedSale.status !== 'completed') {
          showNotification(t('notifications.saleMustBeCompleted'), 'error');
          return;
        }
        const rem = getRemainingReturnQtyForSale(selectedSale);
        const q = qty;
        const used = qtyReturnedBySaleId.get(selectedSale.id) || 0;
        if (q > rem) {
          showNotification(
            t('notifications.qtyExceedsRemainder', { q, rem, used }),
            'error',
          );
          return;
        }
      }
    }
    try {
      const payload = {
        product: parseInt(formData.product, 10),
        quantity: qty,
        reason: formData.reason,
        notes: String(formData.notes || '').trim(),
        sale: parseInt(formData.sale, 10),
        sold_price: refundAmountApi,
        sold_price_currency: formData.sold_price_currency,
      };
      if (formData.customer) {
        payload.customer = parseInt(formData.customer, 10);
      }
      if (Number.isNaN(payload.product) || Number.isNaN(payload.sale)) {
        showNotification(t('notifications.selectProductSale'), 'error');
        return;
      }
      await api.post('/returns/', payload);
      showNotification(t('notifications.created'), 'success');
      setShowForm(false);
      setFormCategory('');
      setFormData({
        product: '',
        sale: '',
        customer: '',
        quantity: '',
        sold_price: '',
        sold_price_currency: 'USD',
        reason: 'customer_request',
        notes: '',
      });
      fetchReturns();
    } catch (error) {
      console.error('Error creating return:', error);
      const d = error.response?.data;
      const msg =
        extractReturnApiError(d) ||
        error.message ||
        t('notifications.createFailed');
      showNotification(typeof msg === 'string' ? msg : t('notifications.createFailed'), 'error');
    }
  };

  const handleMarkRefunded = (returnId) => {
    const returnItem = returns.find((r) => r.id === returnId);
    const due = computeReturnRefundDue(returnItem);
    setRefundFormData({
      returnId,
      uzs: due.currency === 'UZS' && due.amount != null ? String(due.amount) : '',
      usd: due.currency === 'USD' && due.amount != null ? String(due.amount) : '',
    });
    setShowRefundForm(true);
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    const returnItem = refundReturnItem;
    const uzs = parseFloat(refundFormData.uzs) || 0;
    const usd = parseFloat(refundFormData.usd) || 0;
    if (uzs + usd === 0) {
      showNotification(t('notifications.refundAmountRequired'), 'error');
      return;
    }
    const meta = computeReturnRefundMeta(returnItem, refundFormData, cbuRate);
    if (meta.mixed) {
      showNotification(exchangeRateError || t('notifications.exchangeRateLoading'), 'error');
      return;
    }
    if (meta.dueUnavailable) {
      showNotification(t('notifications.refundDueUnavailable'), 'error');
      return;
    }
    const sc = meta.sc;
    const crossSingle =
      (sc === 'USD' && uzs > 0 && usd === 0) || (sc === 'UZS' && usd > 0 && uzs === 0);
    const isCombinedRefund = uzs > 0 && usd > 0;
    let acceptPartialRefund = false;

    if (isCombinedRefund && meta.splitCurrency) {
      if (meta.needs) {
        acceptPartialRefund = true;
      }
      if (
        !window.confirm(
          buildReturnCombinedRefundConfirmMessage({
            returnItem,
            meta,
            uzsAmount: uzs,
            usdAmount: usd,
            exchangeRate,
            cbuRate,
          }),
        )
      ) {
        return;
      }
    } else {
      if (crossSingle && cbuRate) {
        const otherCurrency = sc === 'USD' ? 'UZS' : 'USD';
        const otherAmount = sc === 'USD' ? uzs : usd;
        if (
          !window.confirm(
            buildReturnCrossCurrencyConfirmMessage({
              due: meta.due,
              sc,
              otherCurrency,
              otherAmount,
              paidInSaleCurrency: meta.paid,
              exchangeRate,
              cbuRate,
            }),
          )
        ) {
          return;
        }
      }
      if (meta.needs) {
        acceptPartialRefund = true;
        if (
          !window.confirm(
            buildReturnCombinedRefundConfirmMessage({
              returnItem,
              meta,
              uzsAmount: uzs,
              usdAmount: usd,
              exchangeRate,
              cbuRate,
            }),
          )
        ) {
          return;
        }
      } else if (meta.hasOverpayment && meta.due != null && meta.overpaymentAmount != null) {
        const dueLabel = formatDisplayAmount(meta.due, meta.sc);
        const paidLabel = formatDisplayAmount(meta.paid, meta.sc);
        const excessLabel = formatDisplayAmount(meta.overpaymentAmount, meta.sc);
        const msg = [
          t('notifications.overpaymentTitle'),
          t('notifications.overpaymentDetail', { due: dueLabel, paid: paidLabel, excess: excessLabel }),
          t('notifications.overpaymentBody'),
          t('notifications.overpaymentContinue'),
        ]
          .filter(Boolean)
          .join('\n\n');
        if (!window.confirm(msg)) return;
      }
    }
    try {
      const balanceResponse = await apiGetAll('/cash-balance/');
      const balanceList = balanceResponse.data.results || balanceResponse.data;
      const balChecks = [
        { amount: uzs, currency: 'UZS' },
        { amount: usd, currency: 'USD' },
      ];
      for (const { amount, currency } of balChecks) {
        if (amount > 0) {
          const available = cashBalanceTotalByCurrency(balanceList, currency);
          if (available < amount) {
            showNotification(
              formatInsufficientLedgerMessage(currency, available, amount, { context: 'refund' }),
              'error',
            );
            return;
          }
        }
      }
      if (!isCombinedRefund && !meta.needs && !confirmReturnRefund(returnItem, uzs, usd, meta)) {
        return;
      }
      const requestData = buildReturnRefundRequest(refundFormData, exchangeRate, {
        acceptPartialRefund,
      });
      await api.post(`/returns/${refundFormData.returnId}/mark_refunded/`, requestData);
      setShowRefundForm(false);
      setRefundFormData({ returnId: null, uzs: '', usd: '' });
      showNotification(t('notifications.markedRefunded'), 'success');
      fetchReturns();
    } catch (error) {
      console.error('Error marking return as refunded:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.markFailed'),
        'error',
      );
    }
  };

  const returnsSort = useClientTableSort(RETURNS_SORT_ACCESSORS);
  const displayReturns = useMemo(() => {
    const rows = filteredReturns;
    if (!rows?.length) return rows;
    if (returnsSort.sortCol && RETURNS_SORT_ACCESSORS[returnsSort.sortCol]) {
      const get = RETURNS_SORT_ACCESSORS[returnsSort.sortCol];
      const sign = returnsSort.sortDir === 'desc' ? -1 : 1;
      return [...rows].sort((a, b) => {
        const pending = compareNotRefundedFirst(a, b);
        if (pending !== 0) return pending;
        return compareForSort(get(a), get(b)) * sign;
      });
    }
    return [...rows].sort((a, b) => {
      const pending = compareNotRefundedFirst(a, b);
      if (pending !== 0) return pending;
      const ta = new Date(a.return_date).getTime() || 0;
      const tb = new Date(b.return_date).getTime() || 0;
      return tb - ta;
    });
  }, [filteredReturns, returnsSort]);

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      {notification.visible && (
        <div className={`notification ${notification.type}`} style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 1000,
          padding: '12px 20px', borderRadius: '6px', color: 'white', fontWeight: 500,
          backgroundColor: notification.type === 'success' ? '#4caf50' : '#f44336',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)', maxWidth: '400px'
        }}>
          {notification.message}
        </div>
      )}
      <div className="page-header">
        <PageTitle ns="returns" />
        {canCreateReturn && (
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('actions.cancel', { ns: 'common' }) : t('newReturn')}
        </button>
        )}
      </div>

      {showForm && canCreateReturn && (
        <div className="form-card">
          <h2>{t('form.title')}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              {(() => {
                const searchLower = productSearch.toLowerCase();
                const filteredProductOptions = newReturnFormProducts.filter((p) => {
                  if (!productSearch) return true;
                  const haystack = `${p.id} ${p.brand ?? ''} ${p.model ?? ''} ${p.size ?? ''} ${p.color ?? ''}`.toLowerCase();
                  return haystack.includes(searchLower);
                });
                const selectedReturnProduct =
                  newReturnFormProducts.find((p) => p.id === parseInt(formData.product, 10)) || null;

                return (
                  <>
                  <div className="form-group">
                    <label>{t('form.customerOptional')}</label>
                    <CustomerSearchableSelect
                      customers={newReturnFormCustomers}
                      value={formData.customer}
                      allowEmpty
                      emptyLabel={t('form.allCustomers')}
                      placeholder={t('form.allCustomers')}
                      aria-label={t('form.customerAria')}
                      onChange={(customerId) => {
                        setProductSearch('');
                        setProductDropdownOpen(false);
                        setFormData((prev) =>
                          pruneNewReturnForm({
                            ...prev,
                            customer: customerId,
                            sale: '',
                            sold_price: '',
                            sold_price_currency: 'USD',
                          }),
                        );
                      }}
                    />
                    {(formCategory || formData.product) && (
                      <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                        {t('form.customersHint')}
                        {formCategory ? (
                          <> {t('form.inCategory')} <strong>{formCategory}</strong></>
                        ) : null}
                        {formData.product
                          ? (() => {
                              const p = products.find((x) => x.id === parseInt(formData.product, 10));
                              return p ? (
                                <>
                                  {' '}
                                  {t('form.forProduct')}{' '}
                                  <strong>
                                    {p.brand} {p.model}
                                  </strong>
                                </>
                              ) : null;
                            })()
                          : null}
                        .
                      </small>
                    )}
                  </div>
                  <div className="form-group">
                    <label>
                      {t('form.categoryFilter')}{' '}
                      <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>
                        {t('form.filterHint')}
                      </span>
                    </label>
                    <FormSearchableSelect
                      value={formCategory}
                      onChange={(nextCat) => {
                        setProductSearch('');
                        setProductDropdownOpen(false);
                        setFormCategory(nextCat);
                        setFormData((prev) =>
                          pruneNewReturnForm(
                            {
                              ...prev,
                              product: '',
                              sale: '',
                              sold_price: '',
                              sold_price_currency: 'USD',
                            },
                            nextCat,
                          ),
                        );
                      }}
                      options={newReturnFormCategories}
                      emptyLabel={t('form.allCategories')}
                      placeholder={t('form.allCategories')}
                      aria-label={t('form.categoryFilter')}
                    />
                  </div>
                  <div className="form-group" ref={productDropdownRef} style={{ position: 'relative' }}>
                    <label>{t('form.product')}</label>
                    <>
                      <div
                        onClick={() => {
                          setProductDropdownOpen((o) => !o);
                          setProductSearch('');
                        }}
                        style={{
                          border: '1px solid #ddd',
                          borderRadius: '5px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          background: 'white',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          minHeight: '40px',
                          userSelect: 'none',
                        }}
                      >
                        <span style={{ color: selectedReturnProduct ? '#333' : '#999' }}>
                          {selectedReturnProduct
                            ? returnProductPickerLabel(selectedReturnProduct, t)
                            : t('form.selectProduct')}
                        </span>
                        <span style={{ color: '#666', fontSize: '0.8em' }}>{productDropdownOpen ? '▲' : '▼'}</span>
                      </div>
                      {productDropdownOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            background: 'white',
                            border: '1px solid #ddd',
                            borderRadius: '5px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            zIndex: 100,
                            maxHeight: '320px',
                            display: 'flex',
                            flexDirection: 'column',
                            marginTop: '4px',
                          }}
                        >
                          <div style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                            <input
                              type="text"
                              autoFocus
                              placeholder={t('form.searchProduct')}
                              value={productSearch}
                              onChange={(e) => setProductSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                border: '1px solid #ccc',
                                borderRadius: '5px',
                                fontSize: '14px',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                          <div style={{ overflowY: 'auto', flex: 1 }}>
                            {filteredProductOptions.length === 0 ? (
                              <div
                                style={{
                                  padding: '12px',
                                  color: '#999',
                                  textAlign: 'center',
                                  fontSize: '14px',
                                }}
                              >
                                {t('form.noProducts')}
                              </div>
                            ) : (
                              filteredProductOptions.map((product) => (
                                <div
                                  key={product.id}
                                  role="presentation"
                                  onClick={() => {
                                    const nextCategory = product.category || formCategory;
                                    if (product.category) setFormCategory(product.category);
                                    setFormData((prev) =>
                                      pruneNewReturnForm(
                                        {
                                          ...prev,
                                          product: String(product.id),
                                          sale: '',
                                          sold_price: '',
                                          sold_price_currency: 'USD',
                                        },
                                        nextCategory,
                                      ),
                                    );
                                    setProductDropdownOpen(false);
                                    setProductSearch('');
                                  }}
                                  style={{
                                    padding: '9px 12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    borderBottom: '1px solid #f0f0f0',
                                    background:
                                      parseInt(formData.product, 10) === product.id ? '#e8f4fd' : 'white',
                                    fontWeight: parseInt(formData.product, 10) === product.id ? 600 : 400,
                                  }}
                                  onMouseEnter={(e) => {
                                    if (parseInt(formData.product, 10) !== product.id)
                                      e.currentTarget.style.background = '#f5f5f5';
                                  }}
                                  onMouseLeave={(e) => {
                                    if (parseInt(formData.product, 10) !== product.id)
                                      e.currentTarget.style.background = 'white';
                                  }}
                                >
                                  {returnProductPickerLabel(product, t)}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </>
                    {(formData.customer || formCategory) && (
                      <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                        {formData.customer ? (
                          t('form.productsForCustomer', {
                            name: customers.find((c) => c.id === parseInt(formData.customer, 10))?.name || '',
                          })
                        ) : formCategory ? (
                          t('form.productsReturnableInCategory', { category: formCategory })
                        ) : (
                          t('form.productsReturnable')
                        )}
                        .
                      </small>
                    )}
                  </div>
                  </>
                );
              })()}
              <div className="form-group">
                <label>
                  {t('form.saleRequired')} <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <FormSearchableSelect
                  value={formData.sale}
                  onChange={(saleId) => {
                    const sale = saleId
                      ? sales.find((s) => s.id === parseInt(saleId, 10))
                      : null;
                    const quantity = formData.quantity || '1';
                    if (sale) {
                      if (sale.product_detail?.category) {
                        setFormCategory(sale.product_detail.category);
                      }
                      setFormData((prev) =>
                        mergeSuggestedRefund(
                          {
                            ...prev,
                            sale: saleId,
                            quantity,
                            customer: sale.customer != null ? String(sale.customer) : prev.customer,
                            product: sale.product != null ? String(sale.product) : prev.product,
                          },
                          sale,
                          quantity,
                        ),
                      );
                    } else {
                      setFormData((prev) =>
                        mergeSuggestedRefund(
                          { ...prev, sale: saleId, quantity },
                          sale,
                          quantity,
                        ),
                      );
                    }
                    setRefundAmountTouched(false);
                  }}
                  options={newReturnEligibleSales.map((sale) => ({
                    value: String(sale.id),
                    label: t('form.saleOption', {
                      id: sale.id,
                      brand: sale.product_detail?.brand ?? '',
                      model: sale.product_detail?.model ?? '',
                      customer: sale.customer_detail?.name ? ` (${sale.customer_detail.name})` : '',
                    }),
                  }))}
                  emptyLabel={t('form.selectSale')}
                  placeholder={t('form.selectSale')}
                  aria-label={t('form.saleRequired')}
                />
                {(formData.customer || formData.product || formCategory) && (
                  <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                    {t('form.filteredBy')}{' '}
                    {formData.customer && (
                      <strong>{customers.find((c) => c.id === parseInt(formData.customer, 10))?.name}</strong>
                    )}
                    {formData.customer && (formCategory || formData.product) && ' · '}
                    {formCategory && <strong>{formCategory}</strong>}
                    {formCategory && formData.product && ' · '}
                    {formData.product && (
                      <strong>
                        {products.find((p) => p.id === parseInt(formData.product, 10))?.brand}{' '}
                        {products.find((p) => p.id === parseInt(formData.product, 10))?.model}
                      </strong>
                    )}
                  </small>
                )}
              </div>
              <div className="form-group">
                <label>{t('form.quantityLabel')}</label>
                <input
                  type="number"
                  min="1"
                  max={
                    formData.sale
                      ? (() => {
                          const s = sales.find((x) => x.id === parseInt(formData.sale, 10));
                          const rem = s ? getRemainingReturnQtyForSale(s) : 0;
                          return rem > 0 ? rem : undefined;
                        })()
                      : undefined
                  }
                  value={formData.quantity}
                  onChange={(e) => {
                    const quantity = e.target.value;
                    const sale = resolveSaleForPricing();
                    setFormData((prev) =>
                      mergeSuggestedRefund({ ...prev, quantity }, sale, quantity),
                    );
                  }}
                  required
                />
                {formData.sale && (() => {
                  const selectedSale = sales.find((s) => s.id === parseInt(formData.sale, 10));
                  if (!selectedSale) return null;
                  const remaining = getRemainingReturnQtyForSale(selectedSale);
                  const alreadyReturned = qtyReturnedBySaleId.get(selectedSale.id) || 0;
                  return (
                    <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                      {t('form.originalSaleQty')} <strong>{selectedSale.quantity}</strong>
                      {' · '}
                      {t('form.alreadyOnReturns')} <strong>{alreadyReturned}</strong>
                      {' · '}
                      {t('form.canStillReturn')} <strong>{remaining}</strong>
                    </small>
                  );
                })()}
              </div>
              {formReturnDue.amount != null && !Number.isNaN(formReturnDue.amount) && (
                <div
                  className="form-group"
                  style={{ gridColumn: '1 / -1', marginBottom: 0 }}
                >
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#f0f4f8',
                      borderRadius: '6px',
                      fontSize: '0.9em',
                    }}
                  >
                    <strong>{t('form.saleAmountDue')}</strong>{' '}
                    {formatDisplayAmount(formReturnDue.amount, formReturnDue.currency)}
                    {Number.isFinite(formReturnDue.unitPrice) && (
                      <span style={{ color: '#666', marginLeft: '8px' }}>
                        {t('form.perUnit', {
                          amount: formatDisplayAmount(formReturnDue.unitPrice, formReturnDue.currency),
                        })}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="returns-refund-reason-row" style={{ gridColumn: '1 / -1' }}>
                <div className="form-group returns-refund-reason-row__refund">
                  <label>
                    {t('form.refundAmount')} <span style={{ color: '#e53e3e' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <AmountInput
                      step={formData.sold_price_currency === 'UZS' ? '1' : '0.01'}
                      min={formData.sold_price_currency === 'UZS' ? '1' : '0.01'}
                      required
                      value={formData.sold_price}
                      onChange={(e) => {
                        setRefundAmountTouched(true);
                        setFormData({ ...formData, sold_price: e.target.value });
                      }}
                      placeholder={
                        formReturnDue.amount != null
                          ? t('form.placeholderUpTo', { amount: formReturnDue.amount })
                          : t('form.enterRefund')
                      }
                      style={{ flex: '1 1 160px' }}
                    />
                    <select
                      value={formData.sold_price_currency}
                      onChange={(e) => {
                        const nextCurrency = e.target.value;
                        setRefundAmountTouched(true);
                        setFormData((prev) => {
                          const prevCurrency = prev.sold_price_currency;
                          if (prevCurrency === nextCurrency) return prev;
                          const amountNum = parseFloat(prev.sold_price);
                          if (!Number.isFinite(amountNum) || !cbuRate) {
                            return { ...prev, sold_price_currency: nextCurrency };
                          }
                          const converted =
                            nextCurrency === 'UZS'
                              ? usdToUzs(amountNum, cbuRate)
                              : uzsToUsd(amountNum, cbuRate);
                          return {
                            ...prev,
                            sold_price_currency: nextCurrency,
                            sold_price: formatSoldPriceForApi(converted, nextCurrency) ?? prev.sold_price,
                          };
                        });
                      }}
                      style={{ width: '96px', flexShrink: 0 }}
                    >
                      <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                      <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                    </select>
                    {formReturnDue.amount != null && (
                      <button
                        type="button"
                        className="btn-edit"
                        style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                        onClick={() => {
                          const sale = resolveSaleForPricing();
                          const pricing = applySuggestedRefundAmount(sale, formData.quantity);
                          setRefundAmountTouched(false);
                          setFormData((prev) => ({ ...prev, ...pricing }));
                        }}
                      >
                        {t('form.useFullSaleAmount')}
                      </button>
                    )}
                  </div>
                  <small style={{ color: '#666', marginTop: '6px', display: 'block' }}>
                    {t('form.refundAmountHint')}
                  </small>
                  {(formReturnDue.amount == null || Number.isNaN(formReturnDue.amount)) && (
                    <small style={{ color: '#888', marginTop: '4px', display: 'block' }}>
                      {t('form.selectSaleForDue')}
                    </small>
                  )}
                  {refundAmountOverDue && formReturnDue.amount != null && (
                    <small style={{ color: '#e65100', marginTop: '6px', display: 'block', fontWeight: 500 }}>
                      {t('form.refundExceedsDueInline', {
                        amount: formatDisplayAmount(formReturnDue.amount, formReturnDue.currency),
                      })}
                    </small>
                  )}
                </div>
                <div className="form-group returns-refund-reason-row__reason">
                  <label>{t('form.reason')}</label>
                  <select
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    required
                  >
                    {['defective', 'wrong_size', 'wrong_item', 'customer_request', 'other'].map((reasonKey) => (
                      <option key={reasonKey} value={reasonKey}>
                        {t(`reasons.${reasonKey}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>
                  {formData.reason === 'other' ? t('form.notesRequiredOther') : t('form.notes')}
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows="3"
                  required={formData.reason === 'other'}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('form.submit')}
              </button>
            </div>
          </form>
        </div>
      )}

      {showRefundForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>{t('markRefundedModal.title', { id: refundFormData.returnId })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('markRefundedModal.intro')}
          </p>
          {exchangeRate?.label && (
            <p style={{ color: '#4a5568', marginBottom: '12px', fontSize: '0.85em' }}>
              {exchangeRate.label}
            </p>
          )}
          {exchangeRateError && (
            <p style={{ color: '#b45309', marginBottom: '12px', fontSize: '0.85em' }}>{exchangeRateError}</p>
          )}
          {refundMeta.due != null && !refundMeta.dueUnavailable && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                background: '#f8f9fa',
                borderRadius: 6,
                fontSize: '0.9em',
                color: '#444',
              }}
            >
              <div>
                <strong>{t('markRefundedModal.refundDue')}</strong>{' '}
                {formatDisplayAmount(refundMeta.due, refundMeta.sc)}
              </div>
              {refundMeta.paid != null && (parseFloat(refundFormData.uzs) || parseFloat(refundFormData.usd)) ? (
                <div style={{ marginTop: 6 }}>
                  <strong>
                    {refundMeta.splitCurrency || refundMeta.crossCurrency
                      ? t('markRefundedModal.totalAtCbu', { currency: refundMeta.sc })
                      : t('markRefundedModal.enteredInCurrency', { currency: refundMeta.sc })}
                  </strong>{' '}
                  {formatDisplayAmount(refundMeta.paid, refundMeta.sc)}
                  {refundMeta.needs && (
                    <span style={{ color: '#c62828', marginLeft: 8 }}>
                      {t('markRefundedModal.belowDue', {
                        short: formatDisplayAmount(refundMeta.short, refundMeta.sc),
                      })}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )}
          <form onSubmit={handleRefundSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('refundForm.uzsRefund')}</label>
                <AmountInput placeholder="0"
                  value={refundFormData.uzs}
                  onChange={(e) => setRefundFormData({ ...refundFormData, uzs: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('refundForm.usdRefund')}</label>
                <AmountInput placeholder="0"
                  value={refundFormData.usd}
                  onChange={(e) => setRefundFormData({ ...refundFormData, usd: e.target.value })} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('table.markRefunded')}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowRefundForm(false);
                  setRefundFormData({ returnId: null, uzs: '', usd: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      {!showForm && !showRefundForm && (
        <div className="form-card filter-card" style={{ marginBottom: '16px' }}>
          <h3 className="filter-card__title">{t('filters.title')}</h3>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('filters.categoryType')}</label>
            <select
              value={filters.category_type}
              onChange={(e) => setFilters({ ...filters, category_type: e.target.value })}
            >
              <option value="">{t('filters.allTypes')}</option>
              {PRODUCT_CATEGORY_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`categoryTypes.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <ProductCatalogFilterFields
            filters={filters}
            onFiltersChange={setFilters}
            options={getCascadedFilterOptions(returns, filters, (r) => r.product_detail, null, (ret, _excl) => {
              if (filters.year) {
                const y = new Date(ret.return_date).getFullYear().toString();
                if (y !== filters.year) return false;
              }
              if (filters.month) {
                const m = (new Date(ret.return_date).getMonth() + 1).toString();
                if (m !== filters.month) return false;
              }
              return true;
            })}
            t={t}
            fieldLabels={{
              category: t('filters.category'),
              brand: t('filters.brand'),
              model: t('filters.model'),
              size: t('filters.size'),
              color: t('filters.color'),
            }}
            emptyLabels={{
              category: t('form.allCategories'),
              brand: t('filters.allBrands'),
              model: t('filters.allModels'),
              size: t('filters.allSizes'),
              color: t('filters.allColors'),
            }}
          />
          <div className="filter-field">
            <label>{t('filters.reason')}</label>
            <select
              value={filters.reason}
              onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
            >
              <option value="">{t('filters.allReasons')}</option>
              {['defective', 'wrong_size', 'wrong_item', 'customer_request', 'other'].map((value) => (
                <option key={value} value={value}>{t(`reasons.${value}`)}</option>
              ))}
            </select>
          </div>
          {(() => {
            const dateOpts = getCascadedDateOptions(returns, filters, (r) => r.return_date, (r) => r.product_detail);
            return (
              <>
                <div className="filter-field">
                  <label>{t('filters.year')}</label>
                  <select
                    value={filters.year}
                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                  >
                    <option value="">{t('filters.allYears')}</option>
                    {dateOpts.years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>{t('filters.month')}</label>
                  <select
                    value={filters.month}
                    onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                  >
                    <option value="">{t('filters.allMonths')}</option>
                    {dateOpts.months.map((m) => {
                      const mo = monthOptions.find((o) => o.value === m);
                      return (
                        <option key={m} value={m}>{mo ? mo.label : m}</option>
                      );
                    })}
                  </select>
                </div>
              </>
            );
          })()}
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() =>
                setFilters({
                  category_type: '',
                  category: [],
                  brand: [],
                  model: [],
                  sizes: [],
                  color: [],
                  reason: '',
                  year: '',
                  month: '',
                })
              }
            >
              {t('filters.clearAll')}
            </button>
          </div>
        </div>
        </div>
      )}

      <div className="table-card">
        <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortableTh columnId="id" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.id')}
              </SortableTh>
              <th>{t('table.actions')}</th>
              <SortableTh columnId="refund_status" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.refundStatus')}
              </SortableTh>
              <SortableTh columnId="category_type" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.categoryType')}
              </SortableTh>
              <SortableTh columnId="category" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.category')}
              </SortableTh>
              <SortableTh columnId="brand" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.brand')}
              </SortableTh>
              <SortableTh columnId="model" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.model')}
              </SortableTh>
              <SortableTh columnId="size" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.size')}
              </SortableTh>
              <SortableTh columnId="color" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.color')}
              </SortableTh>
              <SortableTh columnId="sale" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.sale')}
              </SortableTh>
              <SortableTh columnId="customer" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.customer')}
              </SortableTh>
              <SortableTh columnId="phone" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.phone')}
              </SortableTh>
              <SortableTh columnId="quantity" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.quantity')}
              </SortableTh>
              <SortableTh columnId="reason" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.reason')}
              </SortableTh>
              <SortableTh columnId="refund_uzs" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.refundUzs')}
              </SortableTh>
              <SortableTh columnId="refund_usd" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.refundUsd')}
              </SortableTh>
              <SortableTh columnId="notes" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.notes')}
              </SortableTh>
              <SortableTh columnId="processed_by" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.processedBy')}
              </SortableTh>
              <SortableTh columnId="return_date" sortCol={returnsSort.sortCol} sortDir={returnsSort.sortDir} onSort={returnsSort.onHeaderClick}>
                {t('table.date')}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {filteredReturns.length === 0 ? (
              <tr>
                <td colSpan="19" style={{ textAlign: 'center' }}>
                  {t('table.noRows')}
                </td>
              </tr>
            ) : (
              displayReturns.map((returnItem) => (
                <tr key={returnItem.id}>
                  <td>#{returnItem.id}</td>
                  <td>
                    {returnItem.refund_status === 'not_refunded' && canMarkRefunded && (
                      <button
                        className="btn-status"
                        onClick={() => handleMarkRefunded(returnItem.id)}
                      >
                        {t('table.markRefunded')}
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${returnItem.refund_status === 'refunded' ? 'completed' : 'pending'}`}>
                      {t(`refundStatus.${returnItem.refund_status}`, { defaultValue: returnItem.refund_status })}
                    </span>
                  </td>
                  <td>
                    {categoryTypeLabel(returnItem.product_detail?.category_type) || (
                      <span style={{ color: '#999' }}>—</span>
                    )}
                  </td>
                  <td>{returnItem.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
                  <td>{returnItem.product_detail?.brand || '-'}</td>
                  <td>{returnItem.product_detail?.model || '-'}</td>
                  <td><strong>{returnItem.product_detail?.size || '-'}</strong></td>
                  <td><strong>{returnItem.product_detail?.color || '-'}</strong></td>
                  <td>
                    {returnItem.sale ? t('table.saleRef', { id: returnItem.sale }) : '-'}
                  </td>
                  <td>{returnItem.customer_detail?.name || <span style={{ color: '#bbb' }}>—</span>}</td>
                  <td>{returnItem.customer_detail?.telephone || <span style={{ color: '#bbb' }}>—</span>}</td>
                  <td>{returnItem.quantity}</td>
                  <td>{t(`reasons.${returnItem.reason}`, { defaultValue: returnItem.reason })}</td>
                  <td>
                    {(() => { const v = (parseFloat(returnItem.refund_uzs_cash) || 0) + (parseFloat(returnItem.refund_uzs_card) || 0); return v > 0 ? <span style={{ color: '#4caf50' }}>{v.toLocaleString()} UZS</span> : <span style={{ color: '#bbb' }}>—</span>; })()}
                  </td>
                  <td>
                    {(() => { const v = (parseFloat(returnItem.refund_usd_cash) || 0) + (parseFloat(returnItem.refund_usd_card) || 0); return v > 0 ? <span style={{ color: '#4caf50' }}>${v.toFixed(2)}</span> : <span style={{ color: '#bbb' }}>—</span>; })()}
                  </td>
                  <td>{returnItem.notes || <span style={{ color: '#bbb' }}>—</span>}</td>
                  <td>{returnItem.processed_by_detail?.username || '-'}</td>
                  <td>{formatAppDateTime(returnItem.return_date)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="12" style={{ textAlign: 'right' }}>
                {t('table.total')}
              </td>
              <td style={{ fontWeight: 600 }}>{returnColumnTotals.quantity.toLocaleString()}</td>
              <td>—</td>
              <td style={{ fontWeight: 600 }}>
                {returnColumnTotals.uzs > 0 ? `${returnColumnTotals.uzs.toLocaleString()} UZS` : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {returnColumnTotals.usd > 0 ? `$${returnColumnTotals.usd.toFixed(2)}` : '—'}
              </td>
              <td colSpan="3">—</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Returns;

