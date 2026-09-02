import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';
import Modal, { WIDE } from '../components/Modal';
import AmountInput from '../components/AmountInput';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { getCachedProducts } from '../utils/catalogCache';
import i18n from '../i18n';
import {
  formatDisplayAmount,
  formatPlainAmount,
  cashBalanceTotalByCurrency,
  formatInsufficientLedgerMessage,
} from '../utils/currencyFormat';
import SaleCompletePayForm from '../components/SaleCompletePayForm';
import SaleDeliverySettlementForm from '../components/SaleDeliverySettlementForm';
import SaleChangeFields from '../components/SaleChangeFields';
import {
  shopDeliverySettlementRequired,
  shopDeliverySettlementRequiredForGroup,
} from '../utils/saleCompletePayHelpers';
import ShopDeliverySettlementButtons from '../components/ShopDeliverySettlementButtons';
import ProductSearchableSelect from '../components/ProductSearchableSelect';
import CustomerSearchableSelect from '../components/CustomerSearchableSelect';
import ProductCatalogFilterFields from '../components/ProductCatalogFilterFields';
import FormSearchableSelect from '../components/FormSearchableSelect';
import { matchesProductCatalogFilters, getCascadedFilterOptions, getCascadedDateOptions } from '../utils/productFilterUtils';
import { layerSalePickerLabel } from '../utils/productCost';
import {
  EMPTY_PKG_LINES,
  applyLayerToLine,
  applyScanToBatchLines,
  clearLayerFromLine,
  emptyBatchLine,
  findInventoryLayer,
  formatSalePriceForCurrency,
  productForLayer,
} from './batchSaleLines';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { buildBarcodeIndex, looksLikeLayerCode, normalizeScan } from '../utils/layerBarcode';
import { beepError, beepOk, primeScanBeep } from '../utils/scanBeep';
import {
  computeAdvanceRemainingDue,
  computePaymentDifferenceMeta,
  saleHasOrderAdvance,
  getAdvanceCurrency,
  computeReservedPaymentMeta,
  buildSplitCurrencyConfirmMessage,
  buildAdditionalProfitConfirmMessage,
  buildCreditConfirmMessage,
  uzsToUsd,
  usdToUzs,
} from '../utils/saleCompletePayHelpers';
import { runSalePaymentSubmitFlow } from '../utils/salePaymentFlowHelpers';
import ShortfallClassificationFields, {
  isUnderpaidMeta,
} from '../components/ShortfallClassificationFields';
import useCbuExchangeRate from '../hooks/useCbuExchangeRate';
import { usePermissions } from '../hooks/usePermissions';
import { formatAppDateTime } from '../utils/localeFormat';
import './TablePage.css';
import {
  categoryTypeLabel,
  productCategoryTypeOptions,
  useProductCategoryTypes,
} from '../utils/productCategoryTypes';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import PageTitle from '../components/PageTitle';
import FilterPanel from '../components/FilterPanel';
import TableDownloadButton from '../components/TableDownloadButton';
import useAppTranslation from '../hooks/useAppTranslation';
import {
  buildSaleDisplayRows,
  aggregateGroupSales,
  groupDisplayStatus,
  buildCombinedSaleForGroup,
  saleLikeForDisplayRow,
  sumSalesDiscountTotals,
  saleDiscountTotalAmount,
} from '../utils/saleGroupDisplay';

function formatBatchCreateError(data, t) {
  if (!data) return t('notifications.errBatchCreate');
  if (data.item_errors?.length) {
    const row = data.item_errors[0];
    if (row.error) return row.error;
    if (row.errors && typeof row.errors === 'object') {
      const key = Object.keys(row.errors)[0];
      const val = row.errors[key];
      const msg = Array.isArray(val) ? val[0] : val;
      return `${key.replace(/_/g, ' ')}: ${msg}`;
    }
  }
  return data.error || data.detail || t('notifications.errBatchCreate');
}

/** Column accessors — match main sales grid header `columnId`s. Actions column excluded. */
const SALE_SORT_ACCESSORS = {
  id: (s) => Number(s.id) || 0,
  status: (s) => String(s.status ?? '').toLowerCase(),
  category_type: (s) => String(s.product_detail?.category_type ?? '').toLowerCase(),
  category: (s) => String(s.product_detail?.category ?? '').toLowerCase(),
  product: (s) =>
    s.product_detail
      ? `${s.product_detail.brand ?? ''} ${s.product_detail.model ?? ''}`.trim().toLowerCase()
      : String(s.product ?? '').toLowerCase(),
  brand: (s) => String(s.product_detail?.brand ?? '').toLowerCase(),
  model: (s) => String(s.product_detail?.model ?? '').toLowerCase(),
  size: (s) => String(s.product_detail?.size ?? '').toLowerCase(),
  color: (s) => String(s.product_detail?.color ?? '').toLowerCase(),
  sale_type: (s) => String(s.sale_type ?? '').toLowerCase(),
  package: (s) => {
    const lines = s.package_lines;
    if (Array.isArray(lines) && lines.length) {
      return lines.map((pl) => `${pl.package_type ?? ''}:${pl.quantity ?? ''}`).join('|').toLowerCase();
    }
    if (s.package_type) {
      const q = s.package_quantity != null ? s.package_quantity : s.quantity;
      return `${String(s.package_type)}:${q}`.toLowerCase();
    }
    return '';
  },
  quantity: (s) => parseInt(s.quantity, 10) || 0,
  selling_price: (s) => parseFloat(s.selling_price) || 0,
  total_amount: (s) => parseFloat(s.total_amount) || 0,
  discount_credit: (s) =>
    `${saleDiscountTotalAmount(s)}:${String(s.balance_shortfall_type ?? '')}:${parseFloat(s.balance_shortfall_amount) || 0}`,
  uzs_pay: (s) =>
    (parseFloat(s.payment_uzs_cash) || 0) + (parseFloat(s.payment_uzs_card) || 0),
  usd_pay: (s) =>
    (parseFloat(s.payment_usd_cash) || 0) + (parseFloat(s.payment_usd_card) || 0),
  customer: (s) => String(s.customer_detail?.name ?? '').toLowerCase(),
  phone: (s) => String(s.customer_detail?.telephone ?? '').toLowerCase(),
  salesman: (s) => String(s.salesman_detail?.username ?? '').toLowerCase(),
  dispatcher: (s) => {
    const d = s.dispatch_info;
    if (!d) return '';
    if (d.dispatch_type === 'bts' && !d.dispatcher_name) return 'bts';
    return String(d.dispatcher_name ?? '').toLowerCase();
  },
  sale_date: (s) => new Date(s.display_date || s.sale_date).getTime() || 0,
};

const SALE_DISPLAY_SORT_ACCESSORS = Object.fromEntries(
  Object.entries(SALE_SORT_ACCESSORS).map(([key, fn]) => [
    key,
    (row) => fn(saleLikeForDisplayRow(row)),
  ])
);

/** Main sales grid column count (must match thead). */
const SALES_TABLE_COLUMN_COUNT = 22;
/** Footer label spans id → package (inclusive); quantity is the next column. */
const SALES_FOOTER_LABEL_COL_SPAN = 12;

/**
 * Quantity being sold, shown as "3 / 5" when a from-order sale covers only part of what was
 * ordered. A short delivery sells what arrived, so the plain number alone would leave the
 * user wondering why the total is smaller than the order they placed.
 */
function renderSaleQuantityCell(quantity, orderedQuantity, t) {
  const qty = parseInt(quantity, 10) || 0;
  const ordered = orderedQuantity == null ? null : parseInt(orderedQuantity, 10);
  if (ordered == null || !Number.isInteger(ordered) || ordered <= qty) {
    return <>{qty}</>;
  }
  return (
    <span title={t('completeFromOrder.partialQtyHint', { qty, ordered })}>
      <strong>{qty}</strong>
      <span style={{ color: '#999' }}> / {ordered}</span>
      <span
        style={{
          marginLeft: '6px',
          padding: '1px 5px',
          borderRadius: '8px',
          backgroundColor: '#ff9800',
          color: '#fff',
          fontSize: '0.75em',
          whiteSpace: 'nowrap',
        }}
      >
        {t('completeFromOrder.partialQtyBadge', { count: ordered - qty })}
      </span>
    </span>
  );
}

function saleRowBackground(sale) {
  if (parseFloat(sale.credit_amount) > 0 || sale.balance_shortfall_type === 'on_credit') return '#ffebee';
  if (sale.balance_shortfall_type === 'discount') return '#fff3e0';
  return undefined;
}

function renderDiscountCreditCell(sale, t) {
  const saleDiscount = parseFloat(sale.total_discount_amount) || 0;
  const parts = [];
  if (saleDiscount > 0) {
    parts.push(`${t('discount.label')}: ${formatDisplayAmount(saleDiscount, sale.sale_currency || 'USD')}`);
  }
  if (sale.balance_shortfall_type === 'discount' && sale.balance_shortfall_amount) {
    parts.push(
      `${t('discount.atCompletion')}: ${formatDisplayAmount(
        sale.balance_shortfall_amount,
        sale.balance_shortfall_currency || sale.sale_currency || 'USD'
      )}`
    );
  } else if (parseFloat(sale.credit_amount) > 0) {
    parts.push(
      `${t('discount.onCredit')}: ${formatDisplayAmount(
        sale.balance_shortfall_amount,
        sale.balance_shortfall_currency || sale.sale_currency || 'USD'
      )}`
    );
  }
  return parts.length ? parts.join(' · ') : '—';
}

function renderPackageCell(sale, packages) {
  if (sale.package_lines && sale.package_lines.length > 0) {
    return (
      <span style={{ fontSize: '0.85em' }}>
        {sale.package_lines.map((pl, i) => {
          const pkg = packages.find((p) => p.package_type === pl.package_type);
          const costUsd = pkg ? Number(pkg.cost_per_unit_usd) * pl.quantity : 0;
          const costUzs = pkg ? Number(pkg.cost_per_unit_uzs) * pl.quantity : 0;
          return (
            <span key={pl.id ?? i} style={{ display: 'block', whiteSpace: 'nowrap' }}>
              {pl.package_type} ×{pl.quantity}
              {costUsd > 0 ? ` $${costUsd.toFixed(2)}` : ''}
              {costUzs > 0 ? ` ${costUzs.toLocaleString()} UZS` : ''}
            </span>
          );
        })}
      </span>
    );
  }
  if (sale.package_type) {
    return (
      <span>
        {sale.package_type} ×{sale.package_quantity != null ? sale.package_quantity : sale.quantity}
        {sale.package_cost_per_unit_usd > 0 ? ` $${Number(sale.package_cost_per_unit_usd).toFixed(2)}` : ''}
        {sale.package_cost_per_unit_uzs > 0 ? ` ${Number(sale.package_cost_per_unit_uzs).toLocaleString()} UZS` : ''}
      </span>
    );
  }
  return <span style={{ color: '#bbb' }}>—</span>;
}

function renderDispatcherCell(sale) {
  const d = sale.dispatch_info;
  if (!d) return <span style={{ color: '#bbb' }}>—</span>;
  if (d.dispatch_type === 'bts') return d.dispatcher_name || i18n.t('dispatch.bts', { ns: 'sales' });
  return d.dispatcher_name ? d.dispatcher_name : <span style={{ color: '#bbb' }}>—</span>;
}

// findInventoryLayer / productForLayer / formatSalePriceForCurrency now live in
// ./batchSaleLines alongside the line rules that use them — see the import at the top.

function parsePriceNum(str) {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatDiscountForCurrency(discNum, saleCur) {
  if (discNum == null || !Number.isFinite(discNum) || discNum <= 0) return '';
  return formatSalePriceForCurrency(discNum, saleCur);
}

/** list = full price; discount = amount off; selling = final price shown in the form. */
function applyListDiscountFinal(listNum, discNum, finalNum, saleCur) {
  const list = listNum != null && listNum >= 0 ? listNum : 0;
  let final = finalNum != null ? finalNum : list - Math.max(0, discNum ?? 0);
  final = Math.max(0, Math.min(final, list));
  const discount = Math.max(0, list - final);
  return {
    list_price: formatSalePriceForCurrency(list, saleCur),
    selling_price: formatSalePriceForCurrency(final, saleCur),
    discount_price: formatDiscountForCurrency(discount, saleCur),
  };
}

// ----- PackageLinesSelector: compact multi-package row editor -----
function PackageLinesSelector({ lines, onChange, packages: pkgList }) {
  const { t } = useAppTranslation('sales');
  const addLine = () =>
    onChange([...lines, { key: `${Date.now()}-${Math.random()}`, package_type: '', quantity: 1 }]);
  const removeLine = (key) => onChange(lines.filter((l) => l.key !== key));
  const updateLine = (key, field, value) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  const fieldH = { padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {lines.map((line, idx) => {
        const pkg = pkgList.find((p) => p.package_type === line.package_type);
        const isLow = pkg && pkg.quantity < line.quantity;
        const isLast = idx === lines.length - 1;
        return (
          <div key={line.key} style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            {/* Type */}
            <select
              value={line.package_type ?? ''}
              onChange={(e) => updateLine(line.key, 'package_type', e.target.value)}
              style={{ ...fieldH, flex: '1 1 0', minWidth: 0, background: 'white',
                       borderColor: isLow ? '#fc8181' : '#ddd' }}
            >
              <option value="">{t('batch.pkgTypePlaceholder')}</option>
              {pkgList.map((p) => (
                <option key={p.id} value={p.package_type}>
                  {p.package_type} ({p.quantity})
                </option>
              ))}
            </select>

            {/* Qty */}
            <input
              type="number"
              min="1"
              value={line.quantity == null || Number.isNaN(line.quantity) ? 1 : line.quantity}
              onChange={(e) => updateLine(line.key, 'quantity', parseInt(e.target.value, 10) || 1)}
              style={{ ...fieldH, width: '62px', textAlign: 'center', flexShrink: 0,
                       borderColor: isLow ? '#fc8181' : '#ddd' }}
            />

            {/* "+ Add type" on last row, remove button on extra rows */}
            {isLast ? (
              <button type="button" onClick={addLine}
                style={{ ...fieldH, border: '1px dashed #90cdf4', background: 'none',
                         color: '#3182ce', cursor: 'pointer', whiteSpace: 'nowrap',
                         flexShrink: 0, transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#ebf8ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                + {t('batch.addType')}
              </button>
            ) : (
              <button type="button" onClick={() => removeLine(line.key)}
                title={t('actions.delete', { ns: 'common' })}
                style={{ ...fieldH, border: '1px solid #fed7d7', background: '#fff5f5',
                         color: '#e53e3e', cursor: 'pointer', flexShrink: 0,
                         transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#fed7d7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#fff5f5'; }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const Sales = () => {
  // The rendered table, so the download button can read exactly what is on the screen —
  // current filters, current sort, current columns. See utils/tableCsv.
  const tableRef = useRef(null);
  const { t, tStatus, monthOptions } = useAppTranslation(['sales', 'common', 'status']);
  const { hasPermission, hasAnyPermission } = usePermissions();


  const regionChoices = useMemo(
    () =>
      [
        'andijan',
        'bukhara',
        'fergana',
        'jizzakh',
        'kashkadarya',
        'khorezm',
        'namangan',
        'navoi',
        'samarkand',
        'surkhandarya',
        'syrdarya',
        'tashkent_region',
        'karakalpakstan',
        'tashkent_city',
      ].map((value) => ({ value, label: t(`regions.${value}`) })),
    [t],
  );
  const canBatchCreate = hasPermission('sales.batch_create');
  const canCompletePay = hasPermission('sales.complete_pay');
  const canCompleteFromOrder = hasPermission('sales.complete_from_order');
  const canCompleteWithoutPay = hasPermission('sales.complete') && !canCompletePay;
  const canCompleteSale = canCompleteFromOrder || canCompleteWithoutPay || canCompletePay;
  const canDispatch = hasPermission('sales.update_status');
  const canSellReserved = hasPermission('sales.sell_reserved');
  const canCancelReserved = hasPermission('sales.cancel_reserved');
  const canCancelSale = hasPermission('sales.cancel');
  const SALE_TERMINAL_STATUSES = useMemo(() => new Set(['completed', 'returned', 'cancelled']), []);
  const saleHasStartedDeliverySettlement = (sale) => Boolean(
    sale?.delivery_customer_paid_at
    || sale?.delivery_shop_remittance_at
    || sale?.delivery_dispatcher_fee_completed_at
    || sale?.dispatch_info?.is_paid
  );
  const canShowCancelSale = (sale, groupSales = null) => {
    if (!canCancelSale) return false;
    const lines = groupSales?.length ? groupSales : (sale ? [sale] : []);
    if (!lines.length) return false;
    // Multi-item cancel is all-or-nothing: block if any line is completed or settlement started.
    if (lines.some((s) => s.status === 'completed' || s.status === 'returned')) return false;
    if (lines.some((s) => saleHasStartedDeliverySettlement(s))) return false;
    return lines.some((s) => !SALE_TERMINAL_STATUSES.has(s.status));
  };
  const canDeliverySettle = hasAnyPermission([
    'sales.delivery_customer_paid',
    'sales.delivery_shop_received',
    'sales.delivery_pay_dispatch_fee',
  ]);
  const [sales, setSales] = useState([]);
  const knownCategoryTypes = useProductCategoryTypes();
  const productCategoryTypes = useMemo(
    () => productCategoryTypeOptions(sales, t, undefined, knownCategoryTypes),
    [sales, t, knownCategoryTypes],
  );
  const [filteredSales, setFilteredSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchCustomer, setBatchCustomer] = useState('');
  const [batchDefaults, setBatchDefaults] = useState({
    sale_type: 'bought_from_shop',
    sale_currency: 'USD',
  });
  const [batchLines, setBatchLines] = useState([]);
  // What the last scan did, shown above the lines table and read out to screen readers. `seq`
  // exists so two identical scans in a row still re-trigger the strip instead of looking frozen.
  const [scanFeedback, setScanFeedback] = useState(null);
  const scanSeqRef = useRef(0);
  // The basket as it stands right now. `handleScannedCode` folds a scan outside a state updater
  // (an updater must be pure), so it needs a value that is never a render behind.
  const batchLinesRef = useRef(batchLines);
  useEffect(() => { batchLinesRef.current = batchLines; }, [batchLines]);
  const { cbuRate: batchCbuRate, exchangeRateError: batchExchangeRateError } =
    useCbuExchangeRate(showBatchForm);
  const [filters, setFilters] = useState({
    category_type: '',
    category: [],
    brand: [],
    model: [],
    sizes: [],
    color: [],
    status: '',
    sale_type: '',
    customer: '',
    year: '',
    month: '',
  });
  const [customers, setCustomers] = useState([]);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    telephone: '+998',
    instagram: '',
    region: 'tashkent_city',
  });

  const [notification, setNotification] = useState({
    show: false,
    message: '',
    type: 'success', // 'success', 'error', 'info'
  });
  
  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' });
    }, 5000);
  };

  useEffect(() => {
    fetchSales();
    fetchProducts();
    fetchInventory();
    fetchCustomers();
    fetchPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const fetchPackages = async () => {
    if (!hasPermission('packages.view')) {
      setPackages([]);
      return;
    }
    try {
      const response = await apiGetAll('/packages/');
      setPackages(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching packages:', error);
      setPackages([]);
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
  
  /*
   * Closing one of the stage dialogs.
   *
   * Each clears its own draft as well as hiding the dialog, so reopening it for a different sale
   * starts blank rather than carrying the last one's figures — which matters more now that a
   * dialog opens over whatever was clicked instead of appearing as a card you could see.
   *
   * Named rather than inline because each is used twice, by Cancel and by the dialog's own X and
   * Esc, and the two have to do the same thing.
   */
  const closeCustomerForm = () => {
    setShowCustomerForm(false);
    setNewCustomerData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city' });
  };

  const closeDispatchForm = () => {
    setShowDispatchForm(false);
    setDispatchFormData({
      saleId: null,
      delivery_cost: '',
      tracking_number: '',
      dispatch_type: 'dostavshik',
      dispatcher: '',
      is_paid: false,
      currency: 'UZS',
      dispatch_notes: '',
    });
  };

  const closeCompleteFromOrderForm = () => {
    setShowCompleteFromOrderForm(false);
    setCompleteFromOrderPackageLines(EMPTY_PKG_LINES());
    setCompleteFromOrderData({
      saleId: null, customer: '', selling_price: '', sale_type: 'bought_from_shop',
      now_uzs: '', now_usd: '', deposit_received: false, deposit_amount: '', deposit_currency: 'USD',
      balance_shortfall_type: '', balance_shortfall_amount: '',
      apply_credit: false, credit_amount: '', credit_due_date: '',
      apply_currency_conversion_difference: false,
      apply_change: false, change_uzs: '', change_usd: '',
    });
  };

  const closeCompleteFromOrderGroupForm = () => {
    setShowCompleteFromOrderGroupForm(false);
    setCompleteFromOrderGroupData({
      saleGroupId: null, sale_type: 'bought_from_shop',
      deposit_received: false, deposit_amount: '', deposit_currency: 'USD', lines: [],
    });
  };

  const closeSellReservedForm = () => {
    setShowSellReservedForm(false);
    setSellReservedData({
      saleId: null, uzs: '', usd: '', balance_shortfall_type: '',
      balance_shortfall_amount: '', apply_currency_conversion_difference: false,
      apply_additional_profit: false,
      apply_change: false, change_uzs: '', change_usd: '',
    });
  };

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    const name = String(newCustomerData.name || '').trim();
    const telephone = String(newCustomerData.telephone || '').trim();
    if (!name) {
      showNotification(t('customer.errName'), 'error');
      return;
    }
    if (!telephone) {
      showNotification(t('customer.errPhone'), 'error');
      return;
    }
    try {
      const response = await api.post('/customers/', {
        ...newCustomerData,
        name,
        telephone,
      });
      await fetchCustomers();
      if (showBatchForm) {
        setBatchCustomer(String(response.data.id));
      }
      setShowCustomerForm(false);
      setNewCustomerData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city' });
      showNotification(t('customer.created'), 'success');
    } catch (error) {
      console.error('Error creating customer:', error);
      showNotification(error.response?.data?.error || t('customer.errCreate'), 'error');
    }
  };

  const fetchSales = async () => {
    try {
      const response = await apiGetAll('/sales/');
      const salesList = response.data.results || response.data;
      setSales(salesList);
      applyFilters(salesList);
    } catch (error) {
      console.error('Error fetching sales:', error);
    } finally {
      setLoading(false);
    }
  };



  const customerFilterOptions = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      if (c?.id != null) map.set(c.id, c);
    }
    for (const s of sales) {
      const d = s.customer_detail;
      if (d?.id != null && !map.has(d.id)) map.set(d.id, d);
    }
    return [...map.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
  }, [customers, sales]);

  const applyFilters = (salesList) => {
    let filtered = salesList;
    
    if (filters.category_type) {
      filtered = filtered.filter(
        (sale) => sale.product_detail?.category_type === filters.category_type,
      );
    }
    filtered = filtered.filter((sale) => matchesProductCatalogFilters(sale.product_detail, filters));
    if (filters.status) {
      filtered = filtered.filter(sale => sale.status === filters.status);
    }
    if (filters.sale_type) {
      filtered = filtered.filter((sale) => sale.sale_type === filters.sale_type);
    }
    if (filters.customer) {
      if (filters.customer === '__none__') {
        filtered = filtered.filter((sale) => !sale.customer && !sale.customer_detail?.id);
      } else {
        const customerId = parseInt(filters.customer, 10);
        filtered = filtered.filter(
          (sale) =>
            sale.customer === customerId ||
            sale.customer_detail?.id === customerId,
        );
      }
    }
    if (filters.year) {
      filtered = filtered.filter(sale => {
        const saleYear = new Date(sale.sale_date).getFullYear();
        return saleYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(sale => {
        const saleMonth = new Date(sale.sale_date).getMonth() + 1; // getMonth() returns 0-11
        return saleMonth.toString() === filters.month;
      });
    }

    setFilteredSales(filtered);
  };

  useEffect(() => {
    if (sales.length > 0) {
      applyFilters(sales);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const saleSort = useClientTableSort(SALE_DISPLAY_SORT_ACCESSORS);
  const [expandedSaleGroups, setExpandedSaleGroups] = useState(() => new Set());

  const toggleSaleGroup = (groupId) => {
    setExpandedSaleGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const salesDisplayRows = useMemo(
    () => buildSaleDisplayRows(filteredSales, sales),
    [filteredSales, sales]
  );

  const sortedDisplayRows = useMemo(() => {
    const rows = salesDisplayRows;
    if (!rows?.length) return rows;
    if (saleSort.sortCol && SALE_DISPLAY_SORT_ACCESSORS[saleSort.sortCol]) {
      return saleSort.sortRows(rows);
    }
    return [...rows].sort((a, b) => {
      const aSale = saleLikeForDisplayRow(a);
      const bSale = saleLikeForDisplayRow(b);
      const aDone = SALE_TERMINAL_STATUSES.has(aSale.status) ? 1 : 0;
      const bDone = SALE_TERMINAL_STATUSES.has(bSale.status) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const ta = new Date(aSale.display_date || aSale.sale_date).getTime() || 0;
      const tb = new Date(bSale.display_date || bSale.sale_date).getTime() || 0;
      return tb - ta;
    });
  }, [salesDisplayRows, saleSort, SALE_TERMINAL_STATUSES]);

  const salesColumnTotals = useMemo(() => {
    const list = filteredSales;
    if (!list.length) {
      return { quantity: 0, totalAmount: 0, totalAmountCurrency: null, totalDiscount: 0, totalDiscountCurrency: null, uzs: 0, usd: 0 };
    }
    let quantity = 0;
    let totalAmount = 0;
    let uzs = 0;
    let usd = 0;
    const saleCurrencies = new Set();
    for (const s of list) {
      // A cancelled sale never happened, so its units are not units sold. The row stays in the
      // table — you still need to see that it was cancelled — but it does not add to the total,
      // which is read as "how much went out".
      if (s.status !== 'cancelled') {
        quantity += parseInt(s.quantity, 10) || 0;
      }
      totalAmount += parseFloat(s.total_amount) || 0;
      saleCurrencies.add(s.sale_currency || 'USD');
      uzs += (parseFloat(s.payment_uzs_cash) || 0) + (parseFloat(s.payment_uzs_card) || 0);
      usd += (parseFloat(s.payment_usd_cash) || 0) + (parseFloat(s.payment_usd_card) || 0);
    }
    const { total: totalDiscount, currency: totalDiscountCurrency } = sumSalesDiscountTotals(list);
    const totalAmountCurrency = saleCurrencies.size === 1 ? [...saleCurrencies][0] : null;
    return { quantity, totalAmount, totalAmountCurrency, totalDiscount, totalDiscountCurrency, uzs, usd };
  }, [filteredSales]);

  const productIdsWithPositiveInventory = useMemo(() => {
    const ids = new Set();
    for (const item of inventory) {
      if (item.status === 'in_inventory' && Number(item.quantity) > 0) {
        ids.add(Number(item.product));
      }
    }
    return ids;
  }, [inventory]);

  const productsAvailableForSale = useMemo(
    () => products.filter((p) => productIdsWithPositiveInventory.has(Number(p.id))),
    [products, productIdsWithPositiveInventory]
  );

  // All available layers — used for stock validation and as the unfiltered picker base.
  const allBatchLayerPickerItems = useMemo(
    () =>
      inventory
        .filter((layer) => Number(layer.quantity) > 0)
        .map((layer) => {
          const p = productForLayer(layer, products);
          if (!p) return null;
          return {
            value: String(layer.batch_id),
            label: layerSalePickerLabel(p, layer),
            product: p,
            layer,
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) =>
            Number(b.product.id) - Number(a.product.id) || a.label.localeCompare(b.label)
        ),
    [inventory, products]
  );

  const batchCategoryOptions = useMemo(
    () =>
      [...new Set(productsAvailableForSale.map((p) => p.category).filter(Boolean))].sort(),
    [productsAvailableForSale]
  );

  const batchLayerPickerItemsForCategory = (category) => {
    if (!category) return allBatchLayerPickerItems;
    return allBatchLayerPickerItems.filter((item) => item.product.category === category);
  };

  // Clear lines only when a layer truly disappears from inventory (stock ran out),
  // NOT when the category filter changes.
  useEffect(() => {
    if (!showBatchForm) return;
    setBatchLines((lines) => {
      const allowed = new Set(allBatchLayerPickerItems.map((item) => item.value));
      let changed = false;
      const next = lines.map((line) => {
        if (!line.layer) return line;
        if (!allowed.has(String(line.layer))) {
          changed = true;
          return clearLayerFromLine(line);
        }
        return line;
      });
      return changed ? next : lines;
    });
  }, [showBatchForm, allBatchLayerPickerItems]);

  const fetchProducts = async () => {
    try {
      const list = await getCachedProducts(api);
      setProducts(list);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchInventory = async () => {
    try {
      const response = await apiGetAll('/inventory/layers/');
      setInventory(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const updateBatchLine = (key, field, value) => {
    setBatchLines((lines) =>
      lines.map((l) => {
        if (l.key !== key) return l;
        const saleCur = batchDefaults.sale_currency || 'USD';
        if (field === 'category') {
          const next = { ...l, category: value };
          if (value && l.layer) {
            const selected = allBatchLayerPickerItems.find(
              (item) => String(item.value) === String(l.layer)
            );
            if (selected && selected.product?.category !== value) {
              next.layer = '';
              next.product = '';
              next.inventory_batch_id = '';
              next.list_price = '';
              next.selling_price = '';
              next.discount_price = '';
              next.packageLines = EMPTY_PKG_LINES();
            }
          }
          return next;
        }
        if (field === 'layer') {
          return applyLayerToLine(l, value, {
            inventory, products, saleCurrency: saleCur, cbuRate: batchCbuRate,
          });
        }
        if (field === 'selling_price') {
          const listNum = parsePriceNum(l.list_price);
          const finalNum = parsePriceNum(value);
          if (listNum == null || finalNum == null) {
            return { ...l, selling_price: value };
          }
          return { ...l, ...applyListDiscountFinal(listNum, null, finalNum, saleCur) };
        }
        if (field === 'discount_price') {
          const listNum = parsePriceNum(l.list_price);
          if (listNum == null) {
            return { ...l, discount_price: value };
          }
          const discNum = parsePriceNum(value) ?? 0;
          return { ...l, ...applyListDiscountFinal(listNum, discNum, null, saleCur) };
        }
        return { ...l, [field]: value };
      })
    );
  };

  const addBatchLine = () => {
    setBatchLines((lines) => [...lines, emptyBatchLine()]);
  };

  // Layers indexed by the barcode printed on their labels, so a scan is one lookup rather than a
  // walk of the whole inventory.
  const batchLayersByBarcode = useMemo(
    () => buildBarcodeIndex(allBatchLayerPickerItems, (item) => item.layer?.barcode),
    [allBatchLayerPickerItems],
  );

  const announceScan = useCallback((kind, text) => {
    scanSeqRef.current += 1;
    setScanFeedback({ kind, text, seq: scanSeqRef.current });
    if (kind === 'added' || kind === 'incremented') beepOk();
    else beepError();
  }, []);

  /**
   * A barcode arrived — from the wedge hook or the manual box.
   *
   * Silence is the default. The hook fires on any fast keystroke burst, so anything that is not
   * recognisably one of our labels is dropped without a sound; beeping at someone typing quickly
   * would make the page unusable. A code that *does* look like ours but resolves to nothing has
   * earned a message, because the operator is holding a box and needs to know why.
   */
  const handleScannedCode = useCallback((raw) => {
    const code = normalizeScan(raw);
    if (!code) return;

    const item = batchLayersByBarcode.get(code);
    if (!item) {
      if (!looksLikeLayerCode(code)) return;
      // Distinguish "this layer sold out" from "we have never seen this label": one means put the
      // box back, the other means the label needs reprinting.
      const soldOut = inventory.some((l) => normalizeScan(l.barcode) === code);
      announceScan('error', soldOut ? t('batch.scanSoldOut') : t('batch.scanUnknown', { code }));
      return;
    }

    // Folded outside a `setBatchLines` updater, and read from a ref rather than from state.
    // An updater has to be pure — React is free to run it twice — so beeping and announcing from
    // inside one would double up. The ref is advanced synchronously here, so two scans landing in
    // the same tick still see each other and the second increments rather than starting again.
    const { lines: next, result } = applyScanToBatchLines(batchLinesRef.current, item, {
      // Same fallback the picker path uses, so a scanned line and a picked one price alike.
      inventory,
      products,
      saleCurrency: batchDefaults.sale_currency || 'USD',
      cbuRate: batchCbuRate,
    });
    batchLinesRef.current = next;
    setBatchLines(next);

    if (result.kind === 'at-stock-cap') {
      announceScan('warn', t('batch.scanAtStockCap', { count: result.stock }));
    } else if (result.kind === 'incremented') {
      announceScan('incremented', t('batch.scanIncremented', { name: result.label }));
    } else {
      announceScan('added', t('batch.scanAdded', { name: result.label }));
    }
  }, [
    batchLayersByBarcode, inventory, products, batchDefaults.sale_currency, batchCbuRate,
    announceScan, t,
  ]);

  useBarcodeScanner({
    enabled: showBatchForm && canBatchCreate,
    onScan: handleScannedCode,
  });

  // Clear the strip a couple of seconds after the last scan, so it reflects the scan just made
  // rather than one from five minutes ago.
  useEffect(() => {
    if (!scanFeedback) return undefined;
    const timer = setTimeout(() => setScanFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [scanFeedback]);

  const removeBatchLine = (key) => {
    setBatchLines((lines) => (lines.length <= 1 ? lines : lines.filter((l) => l.key !== key)));
  };

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (!batchCustomer) {
      showNotification(t('notifications.errSelectCustomer'), 'error');
      return;
    }
    let freshInventory = inventory;
    try {
      const invRes = await apiGetAll('/inventory/layers/');
      freshInventory = invRes.data.results || invRes.data;
      setInventory(freshInventory);
    } catch (err) {
      console.error('Error refreshing inventory layers:', err);
    }
    if (hasPermission('packages.view')) {
      await fetchPackages();
    }
    const withProduct = batchLines.filter((l) => l.layer && l.product);
    if (withProduct.length === 0) {
      showNotification(t('notifications.errAddLine'), 'error');
      return;
    }
    for (const l of withProduct) {
      if (l.selling_price === '' || l.selling_price == null) {
        showNotification(t('notifications.errSellingPrice'), 'error');
        return;
      }
    }
    // Aggregate package need across all lines for stock check
    const needPkg = new Map();
    const items = withProduct.map((l) => {
      const itemQty = parseInt(String(l.quantity), 10) || 1;
      const activeLines = (l.packageLines || []).filter((pl) => pl.package_type && pl.quantity > 0);
      const disc = parsePriceNum(l.discount_price) || 0;
      const priceForApi = parsePriceNum(disc > 0 ? l.list_price : l.selling_price);
      const row = {
        product: parseInt(l.product, 10),
        quantity: itemQty,
        selling_price:
          priceForApi != null
            ? batchDefaults.sale_currency === 'UZS'
              ? String(Math.round(priceForApi))
              : priceForApi.toFixed(2)
            : String(l.selling_price || '').trim(),
        package_type: null,
        package_quantity: null,
      };
      if (l.inventory_batch_id) {
        row.inventory_batch_id = parseInt(l.inventory_batch_id, 10);
      }
      if (disc > 0) {
        row.discount_price = l.discount_price;
      }
      if (activeLines.length > 0) {
        row.package_lines = activeLines.map(({ package_type, quantity }) => ({ package_type, quantity }));
        for (const pl of activeLines) {
          needPkg.set(pl.package_type, (needPkg.get(pl.package_type) || 0) + pl.quantity);
        }
      }
      return row;
    });
    for (const l of withProduct) {
      const batchId = parseInt(l.inventory_batch_id, 10);
      const need = parseInt(l.quantity, 10) || 0;
      const layer = findInventoryLayer(freshInventory, batchId);
      const available = layer ? Number(layer.quantity) || 0 : 0;
      if (!layer || available < need) {
        const pid = parseInt(l.product, 10);
        showNotification(
          t('notifications.errLayerStock', { pid, need, available }),
          'error'
        );
        return;
      }
    }
    const needByProduct = new Map();
    for (const l of withProduct) {
      const pid = parseInt(l.product, 10);
      const q = parseInt(l.quantity, 10) || 0;
      needByProduct.set(pid, (needByProduct.get(pid) || 0) + q);
    }
    for (const [pid, need] of needByProduct) {
      const available = freshInventory
        .filter((x) => Number(x.product) === pid)
        .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      if (available < need) {
        showNotification(
          t('notifications.errInventory', { pid, need, available }),
          'error'
        );
        return;
      }
    }
    for (const [pt, n] of needPkg) {
      const pkg = packages.find((p) => p.package_type === pt);
      if (!pkg) {
        showNotification(t('notifications.errPkgNotInInventory', { type: pt }), 'error');
        return;
      }
      if (pkg.quantity < n) {
        showNotification(
          t('notifications.errPkgStock', { type: pt, need: n, have: pkg.quantity }),
          'error'
        );
        return;
      }
    }
    try {
      const { data } = await api.post('/sales/batch_create/', {
        customer: parseInt(batchCustomer, 10),
        defaults: {
          sale_type: batchDefaults.sale_type,
          sale_currency: batchDefaults.sale_currency,
          status: 'pending',
        },
        items,
      });
      showNotification(data.message || t('notifications.batchCreated', { count: data.count }), 'success');
      setShowBatchForm(false);
      setBatchCustomer('');
      setBatchLines([]);
      fetchSales();
      fetchInventory();
      fetchPackages();
    } catch (error) {
      console.error('Error batch-creating sales:', error);
      const d = error.response?.data;
      showNotification(formatBatchCreateError(d, t), 'error');
      if (d?.item_errors) {
        console.warn('batch_create item_errors', d.item_errors);
      }
    }
  };

  const [balances, setBalances] = useState([]);
  const [dispatchFormData, setDispatchFormData] = useState({
    saleId: null,
    saleIds: [],
    delivery_cost: '',
    tracking_number: '',
    dispatch_type: 'dostavshik',
    dispatcher: '',
    is_paid: false,
    currency: 'UZS',
    dispatch_notes: '',
  });
  const [dispatchersList, setDispatchersList] = useState([]);
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  
  const [showSellReservedForm, setShowSellReservedForm] = useState(false);
  const [sellReservedData, setSellReservedData] = useState({
    saleId: null,
    uzs: '',
    usd: '',
    balance_shortfall_type: '',
    balance_shortfall_amount: '',
    apply_credit: false,
    credit_amount: '',
    credit_due_date: '',
    apply_currency_conversion_difference: false,
    apply_additional_profit: false,
  });
  
  /** When set, shows shared Complete & Pay form (same flow as Dispatchers tab). */
  const [completePaySale, setCompletePaySale] = useState(null);
  
  const [showCompleteFromOrderForm, setShowCompleteFromOrderForm] = useState(false);
  const { exchangeRate: cfoExchangeRate, exchangeRateError: cfoExchangeRateError } =
    useCbuExchangeRate(showCompleteFromOrderForm);
  const { exchangeRate: sellReservedExchangeRate, exchangeRateError: sellReservedExchangeRateError } =
    useCbuExchangeRate(showSellReservedForm);
  const [completeFromOrderPackageLines, setCompleteFromOrderPackageLines] = useState(EMPTY_PKG_LINES());
  const [completeFromOrderData, setCompleteFromOrderData] = useState({
    saleId: null,
    customer: '',
    selling_price: '',
    sale_type: 'bought_from_shop',
    now_uzs: '',
    now_usd: '',
    deposit_received: false,
    deposit_amount: '',
    deposit_currency: 'USD',
    // Underpayment classification — a gap is a discount and/or an FX difference, never
    // silent customer debt (see ShortfallClassificationFields).
    balance_shortfall_type: '',
    balance_shortfall_amount: '',
    apply_credit: false,
    credit_amount: '',
    credit_due_date: '',
    apply_currency_conversion_difference: false,
    apply_change: false,
    change_uzs: '',
    change_usd: '',
  });

  /** Completing a whole SaleGroup at once (e.g. several items sold individually from the
      same multi-item on_demand order) — sale_type/deposit shared, price/payment per line. */
  const [showCompleteFromOrderGroupForm, setShowCompleteFromOrderGroupForm] = useState(false);
  const { exchangeRate: cfoGroupExchangeRate, exchangeRateError: cfoGroupExchangeRateError } =
    useCbuExchangeRate(showCompleteFromOrderGroupForm);
  const [completeFromOrderGroupData, setCompleteFromOrderGroupData] = useState({
    saleGroupId: null,
    sale_type: 'bought_from_shop',
    deposit_received: false,
    deposit_amount: '',
    deposit_currency: 'USD',
    lines: [],
  });

  // Re-prefill each line's remaining-due-after-advance once the CBU rate loads.
  useEffect(() => {
    if (!showCompleteFromOrderGroupForm) return;
    const rate = cfoGroupExchangeRate?.rate ?? null;
    setCompleteFromOrderGroupData((prev) => {
      if (!prev.lines.length) return prev;
      let changed = false;
      const nextLines = prev.lines.map((line) => {
        const saleRow = sales.find((s) => s.id === line.saleId);
        if (!saleRow || !saleHasOrderAdvance(saleRow)) return line;
        const remaining = computeAdvanceRemainingDue(saleRow, line.selling_price, rate);
        if (remaining == null) return line;
        const sc = (saleRow.sale_currency || 'USD').toUpperCase();
        const nextUzs = sc === 'UZS' ? String(Math.round(remaining)) : line.uzs;
        const nextUsd = sc === 'USD' ? remaining.toFixed(2) : line.usd;
        if (nextUzs === line.uzs && nextUsd === line.usd) return line;
        changed = true;
        return { ...line, uzs: nextUzs, usd: nextUsd };
      });
      return changed ? { ...prev, lines: nextLines } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfoGroupExchangeRate, showCompleteFromOrderGroupForm]);

  // Prefill remaining payment after advance (CBU-convert when advance currency ≠ sale currency).
  useEffect(() => {
    if (!showCompleteFromOrderForm || !completeFromOrderData.saleId) return;
    const sale = sales.find((s) => s.id === completeFromOrderData.saleId);
    if (!sale || !saleHasOrderAdvance(sale)) return;
    const cbuRate = cfoExchangeRate?.rate ?? null;
    const remaining = computeAdvanceRemainingDue(
      sale,
      completeFromOrderData.selling_price,
      cbuRate,
    );
    if (remaining == null) return;
    const sc = (sale.sale_currency || 'USD').toUpperCase();
    const nextUzs = sc === 'UZS' && remaining > 0 ? String(Math.round(remaining)) : sc === 'UZS' ? '0' : '';
    const nextUsd = sc === 'USD' && remaining > 0 ? remaining.toFixed(2) : sc === 'USD' ? '0' : '';
    setCompleteFromOrderData((prev) => {
      if (prev.now_uzs === nextUzs && prev.now_usd === nextUsd) return prev;
      return { ...prev, now_uzs: nextUzs, now_usd: nextUsd };
    });
  }, [
    showCompleteFromOrderForm,
    completeFromOrderData.saleId,
    completeFromOrderData.selling_price,
    cfoExchangeRate?.rate,
    sales,
  ]);

  const openDeliverySettlementModal = async (saleId, groupSales = null) => {
    try {
      const ids = groupSales?.length ? groupSales.map((s) => s.id) : [saleId];
      const results = await Promise.all(ids.map((id) => api.get(`/sales/${id}/`)));
      const lines = results.map((r) => r.data);
      const primary = lines.find((l) => l.id === saleId) || lines[0];
      setCompletePaySale({ ...primary, isSaleGroup: lines.length > 1, groupSales: lines });
    } catch (e) {
      console.error(e);
      showNotification(e.response?.data?.detail || e.response?.data?.error || t('notifications.errLoadSale'), 'error');
    }
  };

  const handleStatusUpdate = async (saleId, newStatus, groupSales = null) => {
    try {
      const targetSales = groupSales?.length ? groupSales : null;
      if (newStatus === 'dispatched') {
        setDispatchFormData({
          saleId: targetSales ? null : saleId,
          saleIds: targetSales ? targetSales.map((s) => s.id) : [saleId],
          delivery_cost: '',
          tracking_number: '',
          dispatch_type: 'dostavshik',
          dispatcher: '',
          is_paid: false,
          currency: 'UZS',
          dispatch_notes: '',
        });
        setShowDispatchForm(true);
      } else if (newStatus === 'completed') {
        const sale = targetSales
          ? buildCombinedSaleForGroup(targetSales)
          : sales.find((s) => s.id === saleId);
        if (!sale) {
          console.warn('Sale not found when trying to complete:', saleId);
          return;
        }
        if (canCompletePay) {
          setCompletePaySale(sale);
        } else if (canCompleteSale) {
          if (targetSales) {
            for (const s of targetSales) {
              await api.post(`/sales/${s.id}/update_status/`, { status: 'completed', notes: '' });
            }
          } else {
            await api.post(`/sales/${saleId}/update_status/`, { status: 'completed', notes: '' });
          }
          fetchSales();
          showNotification(t('notifications.saleCompleted'), 'success');
        }
      } else if (targetSales) {
        for (const s of targetSales) {
          await api.post(`/sales/${s.id}/update_status/`, { status: newStatus, notes: '' });
        }
        fetchSales();
        showNotification(t('notifications.statusUpdated', { status: tStatus(newStatus, 'sale') }), 'success');
      } else {
        await api.post(`/sales/${saleId}/update_status/`, { status: newStatus, notes: '' });
        fetchSales();
        showNotification(t('notifications.statusUpdated', { status: tStatus(newStatus, 'sale') }), 'success');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      if (newStatus !== 'completed') {
        showNotification(t('notifications.errUpdateStatus'), 'error');
      }
    }
  };

  useEffect(() => {
    if (!showDispatchForm) return;
    (async () => {
      try {
        const [dispatchersRes, balancesRes] = await Promise.all([
          apiGetAll('/dispatchers/', { params: { is_active: true } }),
          apiGetAll('/cash-balance/'),
        ]);
        setDispatchersList(dispatchersRes.data.results || dispatchersRes.data);
        setBalances(balancesRes.data.results || balancesRes.data);
      } catch (err) {
        console.error('Error loading dispatch form data:', err);
        setDispatchersList([]);
      }
    })();
  }, [showDispatchForm]);

  const handleDispatchSubmit = async (e) => {
    e.preventDefault();
    const dn = String(dispatchFormData.dispatch_notes || '').trim();
    try {
      if (dispatchFormData.dispatch_type === 'dostavshik') {
        if (!dispatchFormData.dispatcher) {
          showNotification(t('dispatch.errSelectDispatcher'), 'error');
          return;
        }
        if (dispatchersList.length === 0) {
          showNotification(t('dispatch.errNoDispatchers'), 'error');
          return;
        }
      }

      const deliveryCost = parseFloat(dispatchFormData.delivery_cost) || 0;
      if (dispatchFormData.is_paid && deliveryCost > 0) {
        let freshBalances = balances;
        try {
          const balancesRes = await apiGetAll('/cash-balance/');
          freshBalances = balancesRes.data.results || balancesRes.data;
          setBalances(freshBalances);
        } catch (balanceErr) {
          console.error('Error refreshing balances:', balanceErr);
        }
        const currency = dispatchFormData.currency;
        const available = cashBalanceTotalByCurrency(freshBalances, currency);
        if (available < deliveryCost) {
          showNotification(
            formatInsufficientLedgerMessage(currency, available, deliveryCost, {
              topUpSuffix: true,
            }),
            'error',
          );
          return;
        }
      }

      const dispatchData = {
        dispatch_type: dispatchFormData.dispatch_type,
        is_paid: dispatchFormData.is_paid,
        tracking_number: dispatchFormData.tracking_number || '',
        status: 'dispatched',
        logistics_notes: dn || '',
      };
      if (dispatchFormData.dispatch_type === 'dostavshik' && dispatchFormData.dispatcher) {
        dispatchData.dispatcher = parseInt(dispatchFormData.dispatcher, 10);
      }
      dispatchData.delivery_payment_card = 0;

      const saleIds =
        dispatchFormData.saleIds?.length > 0
          ? dispatchFormData.saleIds
          : dispatchFormData.saleId != null
            ? [dispatchFormData.saleId]
            : [];

      // The entered delivery cost is for the WHOLE trip, not per item — split it proportionally
      // by quantity across every line's Dispatch so the group's total cost recorded matches what
      // was actually spent (avoids double/triple-counting the trip cost into COGS/P&L per product).
      const rawCost = parseFloat(dispatchFormData.delivery_cost) || 0;
      const totalQty =
        saleIds.reduce((sum, sid) => {
          const s = sales.find((x) => x.id === sid);
          return sum + (parseInt(s?.quantity, 10) || 1);
        }, 0) || saleIds.length;
      const perUnit = totalQty > 0 ? rawCost / totalQty : 0;
      let allocatedSoFar = 0;
      const lineCosts = saleIds.map((sid, idx) => {
        if (idx === saleIds.length - 1) {
          return Math.round((rawCost - allocatedSoFar) * 100) / 100;
        }
        const s = sales.find((x) => x.id === sid);
        const qty = parseInt(s?.quantity, 10) || 1;
        const share = Math.round(perUnit * qty * 100) / 100;
        allocatedSoFar += share;
        return share;
      });

      for (let i = 0; i < saleIds.length; i++) {
        const sid = saleIds[i];
        const lineCost = saleIds.length > 1 ? lineCosts[i] : rawCost;
        const lineDispatchData = {
          ...dispatchData,
          delivery_cost: dispatchFormData.currency === 'USD' ? lineCost : 0,
          delivery_cost_uzs: dispatchFormData.currency === 'UZS' ? lineCost : 0,
          delivery_payment_cash: dispatchFormData.currency === 'UZS' ? lineCost : 0,
        };
        await api.post('/dispatches/', { ...lineDispatchData, sale: sid });
      }
      
      setShowDispatchForm(false);
      setDispatchFormData({
        saleId: null,
        saleIds: [],
        delivery_cost: '',
        tracking_number: '',
        dispatch_type: 'dostavshik',
        dispatcher: '',
        is_paid: false,
        currency: 'UZS',
        dispatch_notes: '',
      });
      fetchSales();
      showNotification(t('dispatch.success'), 'success');
    } catch (error) {
      console.error('Error creating dispatch:', error);
      const data = error.response?.data;
      const msg =
        data?.error ||
        data?.detail ||
        (Array.isArray(data?.non_field_errors) ? data.non_field_errors[0] : null) ||
        data?.is_paid ||
        (typeof data === 'object' ? Object.values(data).flat().find(Boolean) : null) ||
        t('dispatch.errCreate');
      showNotification(typeof msg === 'string' ? msg : t('dispatch.errCreate'), 'error');
    }
  };

  const handleCompleteFromOrder = async (saleId) => {
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
      setCompleteFromOrderPackageLines(EMPTY_PKG_LINES());
      setCompleteFromOrderData({
        saleId: saleId,
        customer: sale.customer || sale.order_detail?.customer || '',
        selling_price:
          sale.selling_price != null && sale.selling_price !== ''
            ? String(sale.selling_price)
            : '',
        sale_type: 'bought_from_shop',
        now_uzs: '',
        now_usd: '',
        deposit_received: false,
        deposit_amount: '',
        deposit_currency: 'USD',
        balance_shortfall_type: '',
        balance_shortfall_amount: '',
        apply_credit: false,
        credit_amount: '',
        credit_due_date: '',
        apply_currency_conversion_difference: false,
        apply_change: false,
        change_uzs: '',
        change_usd: '',
      });
      setShowCompleteFromOrderForm(true);
    }
  };

  const handleCompleteFromOrderGroup = (groupSales) => {
    if (!groupSales?.length) return;
    const lines = groupSales.map((s) => {
      // computeAdvanceRemainingDue safely returns the full price when there's no advance
      // (no CBU rate needed for that case) — always prefill it, not just when there's an
      // advance, otherwise a no-advance line silently defaults to $0 due.
      const remaining = computeAdvanceRemainingDue(s, s.selling_price, null);
      const sc = (s.sale_currency || 'USD').toUpperCase();
      return {
        saleId: s.id,
        product_detail: s.product_detail,
        quantity: parseInt(s.quantity, 10) || 0,
        orderedQuantity: s.order_ordered_quantity ?? null,
        selling_price: s.selling_price != null && s.selling_price !== '' ? String(s.selling_price) : '',
        uzs: sc === 'UZS' && remaining != null ? String(Math.round(remaining)) : '',
        usd: sc === 'USD' && remaining != null ? remaining.toFixed(2) : '',
        advanceDisplay:
          s.advance_payment_received != null && parseFloat(s.advance_payment_received) > 0
            ? formatDisplayAmount(s.advance_payment_received, getAdvanceCurrency(s))
            : null,
        packageLines: EMPTY_PKG_LINES(),
        // Each line settles on its own, so a shortfall is classified per line too.
        balance_shortfall_type: '',
        balance_shortfall_amount: '',
        apply_credit: false,
        credit_amount: '',
        credit_due_date: '',
        apply_currency_conversion_difference: false,
        apply_change: false,
        change_uzs: '',
        change_usd: '',
      };
    });
    setCompleteFromOrderGroupData({
      saleGroupId: groupSales[0].sale_group_id,
      sale_type: 'bought_from_shop',
      deposit_received: false,
      deposit_amount: '',
      deposit_currency: 'USD',
      lines,
    });
    setShowCompleteFromOrderGroupForm(true);
  };

  const updateCompleteFromOrderGroupLine = (saleId, field, value) => {
    setCompleteFromOrderGroupData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.saleId === saleId ? { ...l, [field]: value } : l)),
    }));
  };

  const handleCompleteFromOrderGroupSubmit = async (e) => {
    e.preventDefault();
    for (const line of completeFromOrderGroupData.lines) {
      if (!(parseFloat(line.selling_price) > 0)) {
        showNotification(t('completeFromOrder.errPrice'), 'error');
        return;
      }
    }
    // Any line with an order advance needs the CBU rate to classify its payment — wait for
    // it rather than letting the backend fetch it live in the middle of the group transaction.
    const anyLineHasAdvance = completeFromOrderGroupData.lines.some((l) => {
      const saleRow = sales.find((s) => s.id === l.saleId);
      return saleHasOrderAdvance(saleRow);
    });
    if (anyLineHasAdvance && !cfoGroupExchangeRate?.rate) {
      showNotification(cfoGroupExchangeRateError || t('completePay.errCbuRate'), 'error');
      return;
    }

    // Package stock is a shared pool across every line — validate combined usage.
    const activeLinesByPkg = completeFromOrderGroupData.lines.map((l) => ({
      saleId: l.saleId,
      active: (l.packageLines || []).filter((pl) => pl.package_type && pl.quantity > 0),
    }));
    const allActive = activeLinesByPkg.flatMap((l) => l.active);
    const neededByType = {};
    for (const pl of allActive) {
      if (!packages.find((p) => p.package_type === pl.package_type)) {
        showNotification(t('notifications.errPkgNotExist', { type: pl.package_type }), 'error');
        return;
      }
      neededByType[pl.package_type] = (neededByType[pl.package_type] || 0) + pl.quantity;
    }
    for (const [pt, needed] of Object.entries(neededByType)) {
      const pkg = packages.find((p) => p.package_type === pt);
      if (pkg && pkg.quantity < needed) {
        showNotification(t('notifications.errPkgInsufficient', { type: pt, need: needed, have: pkg.quantity }), 'error');
        return;
      }
    }

    // Every underpaid line must say why before any of them post — the backend runs the group
    // in one transaction, so a line rejected halfway rolls the whole thing back.
    if (completeFromOrderGroupData.sale_type === 'bought_from_shop') {
      for (const line of completeFromOrderGroupData.lines) {
        const saleRow = sales.find((s) => s.id === line.saleId);
        if (!saleRow) continue;
        const meta = computePaymentDifferenceMeta(
          { ...saleRow, selling_price: line.selling_price },
          {
            uzs: line.uzs,
            usd: line.usd,
            balance_shortfall_type: line.balance_shortfall_type,
            balance_shortfall_amount: line.balance_shortfall_amount,
            apply_credit: line.apply_credit,
            credit_amount: line.credit_amount,
            credit_due_date: line.credit_due_date,
            apply_currency_conversion_difference: line.apply_currency_conversion_difference,
            apply_change: line.apply_change,
            change_uzs: line.change_uzs,
            change_usd: line.change_usd,
          },
          cfoGroupExchangeRate?.rate ?? null,
        );
        if (line.apply_change) {
          const chUzs = parseFloat(line.change_uzs) || 0;
          const chUsd = parseFloat(line.change_usd) || 0;
          if (chUzs <= 0 && chUsd <= 0) {
            showNotification(t('completePay.errChangeAmount'), 'error');
            return;
          }
          if (meta.changePending) {
            showNotification(t('completePay.errRateLoading'), 'error');
            return;
          }
        }
        if (!isUnderpaidMeta(meta)) continue;
        if (line.balance_shortfall_type === 'discount' && !(parseFloat(line.balance_shortfall_amount) > 0)) {
          showNotification(t('completePay.errDiscountAmount'), 'error');
          return;
        }
        // Checked here rather than at the request builder for the same reason the discount is:
        // the backend runs the group in one transaction, so one line rejected halfway rolls
        // every other line back.
        if (meta.creditDueDateMissing) {
          showNotification(t('completePay.errCreditDueDate'), 'error');
          return;
        }
        if (meta.creditConflictsFx) {
          showNotification(t('completePay.errCreditWithFx'), 'error');
          return;
        }
        if (meta.differenceNeedsClassification) {
          showNotification(t('completePay.errShortfall'), 'error');
          return;
        }
      }
    }

    try {
      const payload = {
        sale_group: completeFromOrderGroupData.saleGroupId,
        sale_type: completeFromOrderGroupData.sale_type,
        lines: completeFromOrderGroupData.lines.map((l) => {
          const active = (l.packageLines || []).filter((pl) => pl.package_type && pl.quantity > 0);
          const discount = parseFloat(l.balance_shortfall_amount);
          const isDelivery = completeFromOrderGroupData.sale_type === 'delivery';
          return {
            sale_id: l.saleId,
            selling_price: parseFloat(l.selling_price) || 0,
            uzs: isDelivery ? 0 : parseFloat(l.uzs) || 0,
            usd: isDelivery ? 0 : parseFloat(l.usd) || 0,
            ...(active.length > 0
              ? { package_lines: active.map(({ package_type, quantity }) => ({ package_type, quantity })) }
              : {}),
            ...(l.balance_shortfall_type === 'discount'
              ? {
                balance_shortfall_type: 'discount',
                ...(Number.isFinite(discount) && discount > 0
                  ? { balance_shortfall_amount: discount }
                  : {}),
              }
              : {}),
            // The named share is sent when the user gave one; otherwise the server credits
            // whatever is left of *this line's* due after its own discount, which is the figure
            // the balance sheet later removes on the other side.
            ...(l.apply_credit
              ? {
                apply_credit: true,
                credit_due_date: l.credit_due_date || '',
                ...(parseFloat(l.credit_amount) > 0
                  ? { credit_amount: parseFloat(l.credit_amount) }
                  : {}),
              }
              : {}),
            ...(l.apply_currency_conversion_difference
              ? { apply_currency_conversion_difference: true }
              : {}),
            ...(l.apply_change && !isDelivery
              ? {
                ...((parseFloat(l.change_uzs) || 0) > 0
                  ? { change_uzs: parseFloat(l.change_uzs) }
                  : {}),
                ...((parseFloat(l.change_usd) || 0) > 0
                  ? { change_usd: parseFloat(l.change_usd) }
                  : {}),
              }
              : {}),
          };
        }),
      };
      if (completeFromOrderGroupData.sale_type === 'reserved') {
        payload.deposit_received = completeFromOrderGroupData.deposit_received;
        if (completeFromOrderGroupData.deposit_received) {
          payload.deposit_amount = parseFloat(completeFromOrderGroupData.deposit_amount) || 0;
          payload.deposit_currency = completeFromOrderGroupData.deposit_currency;
        }
      }
      if (cfoGroupExchangeRate?.rate) payload.exchange_rate = cfoGroupExchangeRate.rate;
      await api.post('/sales/complete_from_order_group/', payload);
      setShowCompleteFromOrderGroupForm(false);
      fetchSales();
      showNotification(t('completeFromOrder.successGroup', { count: completeFromOrderGroupData.lines.length }), 'success');
    } catch (error) {
      console.error('Error completing sale group:', error);
      const d = error.response?.data;
      showNotification(d?.error || d?.detail || t('completeFromOrder.errComplete'), 'error');
    }
  };

  const handleCompleteFromOrderSubmit = async (e) => {
    e.preventDefault();
    try {
      const sellingPrice = parseFloat(completeFromOrderData.selling_price);
      
      if (!sellingPrice || sellingPrice <= 0) {
        showNotification(t('completeFromOrder.errPrice'), 'error');
        return;
      }
      
      // Validate multi-package lines for complete-from-order
      const cfoActiveLines = completeFromOrderPackageLines.filter((l) => l.package_type && l.quantity > 0);
      for (const line of cfoActiveLines) {
        const pkg = packages.find((p) => p.package_type === line.package_type);
        if (!pkg) {
          showNotification(t('notifications.errPkgNotExist', { type: line.package_type }), 'error');
          return;
        }
        const totalNeeded = cfoActiveLines
          .filter((l) => l.package_type === line.package_type)
          .reduce((s, l) => s + l.quantity, 0);
        if (pkg.quantity < totalNeeded) {
          showNotification(t('notifications.errPkgInsufficient', { type: line.package_type, need: totalNeeded, have: pkg.quantity }), 'error');
          return;
        }
      }

      const saleForComplete = sales.find((s) => s.id === completeFromOrderData.saleId);
      let paymentPayload = {
        uzs: parseFloat(completeFromOrderData.now_uzs) || 0,
        usd: parseFloat(completeFromOrderData.now_usd) || 0,
      };
      // Reserved sales take a deposit instead; delivery sales are collected by the courier
      // at settlement, so neither runs the counter-payment flow here.
      if (completeFromOrderData.sale_type === 'delivery') {
        paymentPayload = { uzs: 0, usd: 0 };
      } else if (completeFromOrderData.sale_type !== 'reserved') {
        const flow = await runSalePaymentSubmitFlow({
          sale: saleForComplete,
          paymentFormData: {
            uzs: completeFromOrderData.now_uzs,
            usd: completeFromOrderData.now_usd,
            balance_shortfall_type: completeFromOrderData.balance_shortfall_type,
            balance_shortfall_amount: completeFromOrderData.balance_shortfall_amount,
            apply_credit: completeFromOrderData.apply_credit,
            credit_amount: completeFromOrderData.credit_amount,
            credit_due_date: completeFromOrderData.credit_due_date,
            apply_currency_conversion_difference:
              completeFromOrderData.apply_currency_conversion_difference,
            apply_change: completeFromOrderData.apply_change,
            change_uzs: completeFromOrderData.change_uzs,
            change_usd: completeFromOrderData.change_usd,
          },
          exchangeRate: cfoExchangeRate,
          exchangeRateError: cfoExchangeRateError,
          showNotification,
          sellingPriceOverride: completeFromOrderData.selling_price,
        });
        if (!flow.ok) return;
        paymentPayload = {
          uzs: flow.requestData.uzs,
          usd: flow.requestData.usd,
          ...(flow.requestData.exchange_rate != null
            ? { exchange_rate: flow.requestData.exchange_rate }
            : {}),
          ...(flow.requestData.apply_additional_profit
            ? { apply_additional_profit: true }
            : {}),
          ...(flow.requestData.balance_shortfall_type
            ? {
              balance_shortfall_type: flow.requestData.balance_shortfall_type,
              ...(flow.requestData.balance_shortfall_amount != null
                ? { balance_shortfall_amount: flow.requestData.balance_shortfall_amount }
                : {}),
            }
            : {}),
          ...(flow.requestData.apply_credit
            ? {
              apply_credit: true,
              credit_due_date: flow.requestData.credit_due_date,
              ...(flow.requestData.credit_amount != null
                ? { credit_amount: flow.requestData.credit_amount }
                : {}),
            }
            : {}),
          ...(flow.requestData.apply_currency_conversion_difference
            ? { apply_currency_conversion_difference: true }
            : {}),
          ...(flow.requestData.apply_credit
            ? {
              apply_credit: true,
              credit_due_date: flow.requestData.credit_due_date,
              ...(flow.requestData.credit_amount != null
                ? { credit_amount: flow.requestData.credit_amount }
                : {}),
            }
            : {}),
          ...(flow.requestData.change_uzs != null
            ? { change_uzs: flow.requestData.change_uzs }
            : {}),
          ...(flow.requestData.change_usd != null
            ? { change_usd: flow.requestData.change_usd }
            : {}),
        };
      }

      const requestData = {
        customer: completeFromOrderData.customer,
        selling_price: sellingPrice,
        sale_type: completeFromOrderData.sale_type,
        package_type: null,
        package_quantity: null,
        uzs: paymentPayload.uzs,
        usd: paymentPayload.usd,
        ...(paymentPayload.exchange_rate != null
          ? { exchange_rate: paymentPayload.exchange_rate }
          : {}),
        ...(paymentPayload.apply_additional_profit
          ? { apply_additional_profit: true }
          : {}),
        ...(paymentPayload.balance_shortfall_type
          ? {
            balance_shortfall_type: paymentPayload.balance_shortfall_type,
            ...(paymentPayload.balance_shortfall_amount != null
              ? { balance_shortfall_amount: paymentPayload.balance_shortfall_amount }
              : {}),
          }
          : {}),
        ...(paymentPayload.apply_credit
          ? {
            apply_credit: true,
            credit_due_date: paymentPayload.credit_due_date,
            ...(paymentPayload.credit_amount != null
              ? { credit_amount: paymentPayload.credit_amount }
              : {}),
          }
          : {}),
        ...(paymentPayload.apply_currency_conversion_difference
          ? { apply_currency_conversion_difference: true }
          : {}),
        ...(paymentPayload.change_uzs != null ? { change_uzs: paymentPayload.change_uzs } : {}),
        ...(paymentPayload.change_usd != null ? { change_usd: paymentPayload.change_usd } : {}),
        ...(cfoActiveLines.length > 0 ? {
          package_lines: cfoActiveLines.map(({ package_type, quantity }) => ({ package_type, quantity })),
        } : {}),
      };

      // Add deposit fields if reserved sale
      if (completeFromOrderData.sale_type === 'reserved') {
        requestData.deposit_received = completeFromOrderData.deposit_received;
        if (completeFromOrderData.deposit_received && completeFromOrderData.deposit_amount) {
          requestData.deposit_amount = parseFloat(completeFromOrderData.deposit_amount);
          requestData.deposit_currency = completeFromOrderData.deposit_currency;
        }
      }
      
      await api.post(`/sales/${completeFromOrderData.saleId}/complete_from_order/`, requestData);
      
      // If delivery sale, show dispatch form instead of closing
      if (completeFromOrderData.sale_type === 'delivery') {
        setShowCompleteFromOrderForm(false);
        setDispatchFormData({
          saleId: completeFromOrderData.saleId,
          delivery_cost: '',
          tracking_number: '',
          dispatch_type: 'dostavshik',
          dispatcher: '',
          is_paid: false,
          currency: 'UZS',
          dispatch_notes: '',
        });
        setShowDispatchForm(true);
        setCompleteFromOrderPackageLines(EMPTY_PKG_LINES());
        setCompleteFromOrderData({
          saleId: null, customer: '', selling_price: '', sale_type: 'bought_from_shop',
          now_uzs: '', now_usd: '', deposit_received: false, deposit_amount: '', deposit_currency: 'USD',
        });
        fetchSales();
        showNotification(t('completeFromOrder.successDispatch'), 'success');
      } else {
        setShowCompleteFromOrderForm(false);
        setCompleteFromOrderPackageLines(EMPTY_PKG_LINES());
        setCompleteFromOrderData({
          saleId: null, customer: '', selling_price: '', sale_type: 'bought_from_shop',
          now_uzs: '', now_usd: '', deposit_received: false, deposit_amount: '', deposit_currency: 'USD',
        });
        fetchSales();
        showNotification(t('completeFromOrder.success'), 'success');
      }
    } catch (error) {
      console.error('Error completing sale from order:', error);
      showNotification(error.response?.data?.error || t('completeFromOrder.errComplete'), 'error');
    }
  };

  const handleCancelReserved = async (saleId) => {
    if (window.confirm(t('notifications.confirmCancelReserved'))) {
      try {
        await api.post(`/sales/${saleId}/cancel_reserved/`);
        fetchSales();
        fetchInventory();
        showNotification(t('notifications.cancelReservedSuccess'), 'success');
      } catch (error) {
        console.error('Error cancelling reserved sale:', error);
        showNotification(error.response?.data?.error || t('notifications.errCancelReserved'), 'error');
      }
    }
  };

  const handleCancelSale = async (saleId, groupSales = null) => {
    if (!canCancelSale) {
      showNotification(t('notifications.errCancelSale'), 'error');
      return;
    }
    const lines = groupSales?.length ? groupSales : null;
    const openCount = lines
      ? lines.filter((s) => !SALE_TERMINAL_STATUSES.has(s.status)).length
      : 1;
    const confirmMsg = openCount > 1
      ? t('notifications.confirmCancelSaleGroup', { count: openCount })
      : t('notifications.confirmCancelSale');
    if (!window.confirm(confirmMsg)) {
      return;
    }
    try {
      // Backend cancels the whole SaleGroup when the sale belongs to one.
      await api.post(`/sales/${saleId}/cancel/`);
      fetchSales();
      fetchInventory();
      showNotification(
        openCount > 1
          ? t('notifications.cancelSaleGroupSuccess', { count: openCount })
          : t('notifications.cancelSaleSuccess'),
        'success',
      );
    } catch (error) {
      console.error('Error cancelling sale:', error);
      showNotification(error.response?.data?.error || t('notifications.errCancelSale'), 'error');
    }
  };

  const handleSellReserved = async (saleId) => {
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
      // Calculate total including package cost
      const itemTotal = parseFloat(sale.selling_price) * sale.quantity;
      const packageCost = sale.package_cost || 0;
      const totalAmount = itemTotal + parseFloat(packageCost);
      const depositAmount = sale.deposit_amount || 0;
      const remainingAmount = totalAmount - depositAmount;
      
      const remUsd = (sale.sale_currency || 'USD') === 'USD' && remainingAmount > 0 ? remainingAmount.toFixed(2) : '';
      const remUzs = (sale.sale_currency || 'USD') === 'UZS' && remainingAmount > 0 ? String(Math.round(remainingAmount)) : '';
      setSellReservedData({
        saleId: saleId,
        uzs: remUzs,
        usd: remUsd,
        balance_shortfall_type: '',
        balance_shortfall_amount: '',
        apply_currency_conversion_difference: false,
        apply_additional_profit: false,
        apply_change: false,
        change_uzs: '',
        change_usd: '',
      });
      setShowSellReservedForm(true);
    }
  };

  const handleSellReservedSubmit = async (e) => {
    e.preventDefault();
    try {
      const sale = sales.find((s) => s.id === sellReservedData.saleId);
      const cbuRate = sellReservedExchangeRate?.rate ?? null;
      const meta = computeReservedPaymentMeta(
        sale,
        sellReservedData.uzs,
        sellReservedData.usd,
        cbuRate,
        sellReservedData,
      );
      const uzsT = parseFloat(sellReservedData.uzs) || 0;
      const usdT = parseFloat(sellReservedData.usd) || 0;
      // The one settlement that legitimately arrives with nothing: the customer takes the
      // reserved item and owes the balance after their deposit.
      if (uzsT + usdT === 0 && !sellReservedData.apply_credit) {
        showNotification(t('sellReserved.errPayment'), 'error');
        return;
      }
      if (meta.needsRate) {
        showNotification(
          sellReservedExchangeRateError || t('completePay.errRateLoading'),
          'error',
        );
        return;
      }
      if (meta.splitCurrency) {
        if (
          !window.confirm(
            buildSplitCurrencyConfirmMessage({
              sale,
              uzsAmount: uzsT,
              usdAmount: usdT,
              due: meta.due,
              sc: meta.sc,
              cbuRate,
              paidInSaleCurrency: meta.paid,
              exchangeRate: sellReservedExchangeRate,
            }),
          )
        ) {
          return;
        }
      }
      const wantDisc = sellReservedData.balance_shortfall_type === 'discount';
      const wantFx = !!sellReservedData.apply_currency_conversion_difference;
      const wantCredit = !!sellReservedData.apply_credit;
      const discAmt = parseFloat(sellReservedData.balance_shortfall_amount) || 0;
      if (wantDisc && discAmt <= 0) {
        showNotification(t('completePay.errDiscountAmount'), 'error');
        return;
      }
      if (wantCredit) {
        if (meta.creditWithNothingOwing) {
          showNotification(t('completePay.errCreditNothingOwing'), 'error');
          return;
        }
        if (meta.sharesExceedGap) {
          showNotification(t('completePay.errSharesExceedGap'), 'error');
          return;
        }
        if (meta.creditDueDateMissing) {
          showNotification(t('completePay.errCreditDueDate'), 'error');
          return;
        }
        if (
          !window.confirm(
            buildCreditConfirmMessage(meta, sellReservedData.credit_due_date),
          )
        ) {
          return;
        }
      }
      if (meta.needsDiscountChoice && !wantDisc && !wantFx && !wantCredit) {
        showNotification(t('completePay.errShortfall'), 'error');
        return;
      }
      const changeUzs = sellReservedData.apply_change
        ? parseFloat(sellReservedData.change_uzs) || 0 : 0;
      const changeUsd = sellReservedData.apply_change
        ? parseFloat(sellReservedData.change_usd) || 0 : 0;
      if (sellReservedData.apply_change) {
        if (changeUzs <= 0 && changeUsd <= 0) {
          showNotification(t('completePay.errChangeAmount'), 'error');
          return;
        }
        if (meta.changePending) {
          showNotification(t('completePay.errRateLoading'), 'error');
          return;
        }
      }
      const payload = {
        uzs: uzsT,
        usd: usdT,
      };
      if (changeUzs > 0) payload.change_uzs = changeUzs;
      if (changeUsd > 0) payload.change_usd = changeUsd;
      if (
        sellReservedExchangeRate?.rate
        && (meta.splitCurrency || meta.crossCurrency || changeUzs > 0 || changeUsd > 0)
      ) {
        payload.exchange_rate = sellReservedExchangeRate.rate;
      }
      if (wantDisc) {
        payload.balance_shortfall_type = 'discount';
        payload.balance_shortfall_amount = discAmt;
      }
      if (wantFx) {
        payload.apply_currency_conversion_difference = true;
      }
      if (wantCredit) {
        payload.apply_credit = true;
        payload.credit_due_date = String(sellReservedData.credit_due_date || '').trim();
        const namedCredit = parseFloat(sellReservedData.credit_amount);
        if (Number.isFinite(namedCredit) && namedCredit > 0) {
          payload.credit_amount = namedCredit;
        }
      }
      const overpayTol = meta.sc === 'UZS' ? 1 : 0.005;
      const isOverpay = meta.paid != null && meta.due != null && meta.paid - meta.due > overpayTol;
      if (isOverpay && !wantDisc && !wantFx) {
        if (
          !window.confirm(
            buildAdditionalProfitConfirmMessage(
              { ...meta, overpaymentAmount: meta.paid - meta.due },
              sellReservedExchangeRate,
            ),
          )
        ) {
          return;
        }
        payload.apply_additional_profit = true;
      }
      await api.post(`/sales/${sellReservedData.saleId}/sell_reserved/`, payload);
      setShowSellReservedForm(false);
      setSellReservedData({
        saleId: null, uzs: '', usd: '', balance_shortfall_type: '',
        balance_shortfall_amount: '', apply_currency_conversion_difference: false,
        apply_additional_profit: false,
        apply_credit: false, credit_amount: '', credit_due_date: '',
        apply_change: false, change_uzs: '', change_usd: '',
      });
      fetchSales();
      showNotification(t('sellReserved.success'), 'success');
    } catch (error) {
      console.error('Error completing reserved sale:', error);
      showNotification(error.response?.data?.error || t('sellReserved.errComplete'), 'error');
    }
  };

  const sellReservedSaleForForm = showSellReservedForm
    ? sales.find((s) => s.id === sellReservedData.saleId)
    : null;
  const sellReservedPayMeta = computeReservedPaymentMeta(
    sellReservedSaleForForm,
    sellReservedData.uzs,
    sellReservedData.usd,
    sellReservedExchangeRate?.rate ?? null,
    sellReservedData,
  );
  // Offered whenever anything is still owing, not only once a payment has come up short.
  const sellReservedCreditAvailable =
    sellReservedSaleForForm != null
    && sellReservedPayMeta.gap != null
    && sellReservedPayMeta.gap > (sellReservedPayMeta.sc === 'UZS' ? 1 : 0.005);
  // Same rule as Complete & Pay: keyed off the gross surplus, so the panel does not vanish the
  // moment the change entered in it makes the payment read as exact.
  const sellReservedChangeAvailable = !!sellReservedSaleForForm && (
    sellReservedData.apply_change
    || (
      sellReservedPayMeta.requiredChange != null
      && sellReservedPayMeta.requiredChange > (sellReservedPayMeta.sc === 'UZS' ? 1 : 0.005)
    )
  );

  /** Payment meta for a Complete-from-Order line — one shape for the single form and the group. */
  const cfoMetaFor = (saleRow, form, isGroupLine = false) =>
    computePaymentDifferenceMeta(
      { ...saleRow, selling_price: form.selling_price },
      {
        uzs: isGroupLine ? form.uzs : form.now_uzs,
        usd: isGroupLine ? form.usd : form.now_usd,
        balance_shortfall_type: form.balance_shortfall_type,
        balance_shortfall_amount: form.balance_shortfall_amount,
        apply_currency_conversion_difference: form.apply_currency_conversion_difference,
        apply_change: form.apply_change,
        change_uzs: form.change_uzs,
        change_usd: form.change_usd,
      },
      (isGroupLine ? cfoGroupExchangeRate : cfoExchangeRate)?.rate ?? null,
    );

  const renderSaleActionsCell = (sale, groupSales = null) => {
    const actionFor = (status) => handleStatusUpdate(sale.id, status, groupSales || undefined);
    const showCancel = canShowCancelSale(sale, groupSales);
    const cancelTargetId = groupSales?.length
      ? (groupSales.find((s) => !SALE_TERMINAL_STATUSES.has(s.status))?.id || sale.id)
      : sale.id;
    return (
      <>
        {(sale.status === 'pending' || sale.status === 'confirmed') &&
          sale.sale_type === 'delivery' &&
          !sale.dispatch_info &&
          canDispatch && (
            <ActionButton type="button" className="btn-status" onClick={() => actionFor('dispatched')}>
              {t('rowActions.dispatch', { ns: 'sales' })}
            </ActionButton>
          )}
        {(sale.status === 'pending' || sale.status === 'confirmed') && sale.sale_type === 'bought_from_shop' && canCompletePay && (
          <ActionButton type="button" className="btn-status" onClick={() => actionFor('completed')}>
            {t('rowActions.completePay', { ns: 'sales' })}
          </ActionButton>
        )}
        {(sale.status === 'pending' || sale.status === 'confirmed') &&
          sale.sale_type === 'bought_from_shop' &&
          canCompleteWithoutPay && (
            <ActionButton
              type="button"
              className="btn-status"
              onClick={() => actionFor('completed')}
              style={{ backgroundColor: '#4caf50', color: 'white' }}
            >
              {t('rowActions.completeSale', { ns: 'sales' })}
            </ActionButton>
          )}
        {shopDeliverySettlementRequiredForGroup(groupSales?.length ? { groupSales } : sale) && canDeliverySettle && (
          <ShopDeliverySettlementButtons
            sale={sale}
            groupSales={groupSales}
            classNameButton="btn-status"
            onOpenSettlement={openDeliverySettlementModal}
          />
        )}
        {sale.status === 'dispatched' && !shopDeliverySettlementRequired(sale) && canCompletePay && (
          <ActionButton type="button" className="btn-status" onClick={() => actionFor('completed')}>
            {t('rowActions.completePay', { ns: 'sales' })}
          </ActionButton>
        )}
        {(groupSales?.length
          ? groupSales.some((s) => s.status === 'pending' && s.sale_type === 'from_order')
          : sale.status === 'pending' && sale.sale_type === 'from_order') &&
          canCompleteFromOrder && (
          <button
            type="button"
            className="btn-status"
            onClick={() => {
              if (groupSales?.length) {
                handleCompleteFromOrderGroup(
                  groupSales.filter((s) => s.status === 'pending' && s.sale_type === 'from_order'),
                );
              } else {
                handleCompleteFromOrder(sale.id);
              }
            }}
            style={{ backgroundColor: '#4caf50', color: 'white' }}
          >
            {t('rowActions.completeSale', { ns: 'sales' })}
          </button>
        )}
        {sale.status === 'reserved' && sale.sale_type === 'reserved' && (
          <>
            {canSellReserved && (
            <button
              type="button"
              className="btn-status"
              onClick={() => handleSellReserved(sale.id)}
              style={{ backgroundColor: '#4caf50', color: 'white', marginBottom: '5px' }}
            >
              {t('rowActions.sell', { ns: 'sales' })}
            </button>
            )}
            {showCancel ? (
            <ActionButton
              type="button"
              className="btn-edit"
              onClick={() => handleCancelSale(cancelTargetId, groupSales)}
              style={{ backgroundColor: '#f44336', color: 'white' }}
            >
              {t('rowActions.cancelSale', { ns: 'sales' })}
            </ActionButton>
            ) : canCancelReserved && !groupSales?.length ? (
            <ActionButton
              type="button"
              className="btn-edit"
              onClick={() => handleCancelReserved(sale.id)}
              style={{ backgroundColor: '#f44336', color: 'white' }}
            >
              {t('rowActions.cancelReserved', { ns: 'sales' })}
            </ActionButton>
            ) : null}
            {sale.deposit_received && (
              <span style={{ fontSize: '0.85em', color: '#666', display: 'block', marginTop: '5px' }}>
                {t('deposit', { ns: 'sales' })}: {formatDisplayAmount(sale.deposit_amount, sale.deposit_currency || 'USD')}
              </span>
            )}
          </>
        )}
        {showCancel && !(sale.status === 'reserved' && sale.sale_type === 'reserved') && (
          <ActionButton
            type="button"
            className="btn-edit"
            onClick={() => handleCancelSale(cancelTargetId, groupSales)}
            style={{ backgroundColor: '#f44336', color: 'white', marginTop: '5px' }}
          >
            {t('rowActions.cancelSale', { ns: 'sales' })}
          </ActionButton>
        )}
        {['completed', 'returned'].includes(sale.status) && sale.payment_currency && (
          <span style={{ fontSize: '0.9em', color: '#666', display: 'block', marginTop: '5px' }}>
            {t('paid', { ns: 'sales' })}: {sale.payment_currency}
          </span>
        )}
      </>
    );
  };

  const renderSaleProductCells = (sale, { detail = false } = {}) => {
    const detailClass = detail ? 'sale-group-detail-row__cell' : '';
    const saleTypeLabel = sale.sale_type ? t(`saleTypes.${sale.sale_type}`, { ns: 'sales' }) : '—';
    const uzsPay =
      (parseFloat(sale.payment_uzs_cash) || 0) + (parseFloat(sale.payment_uzs_card) || 0);
    const usdPay =
      (parseFloat(sale.payment_usd_cash) || 0) + (parseFloat(sale.payment_usd_card) || 0);
    return (
      <>
        <td className={detailClass}>
          <span className={`status-badge ${sale.status}`}>{tStatus(sale.status, 'sale')}</span>
          {sale.declinedCount > 0 && (
            <small style={{ display: 'block', color: '#b45309', marginTop: 2 }}>
              {t('deliverySettlement.declinedCountBadge', { ns: 'sales', count: sale.declinedCount })}
            </small>
          )}
        </td>
        <td className={detailClass}>
          {/* Through the shared helper like every other page: a bare `t()` here printed the key
              itself, so a type the shop invented read as `categoryTypes.Классика`. */}
          {categoryTypeLabel(sale.product_detail?.category_type, t) || (
            <span style={{ color: '#999' }}>—</span>
          )}
        </td>
        <td className={detailClass}>{sale.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
        <td className={detailClass}>{sale.product_detail?.brand || '-'}</td>
        <td className={detailClass}>{sale.product_detail?.model || '-'}</td>
        <td className={detailClass}><strong>{sale.product_detail?.size || '-'}</strong></td>
        <td className={detailClass}><strong>{sale.product_detail?.color || '-'}</strong></td>
        <td className={detailClass}>{saleTypeLabel}</td>
        <td className={detailClass}>{renderPackageCell(sale, packages)}</td>
        <td className={detailClass}>{sale.quantity}</td>
        <td className={detailClass}>{formatDisplayAmount(sale.selling_price, sale.sale_currency || 'USD')}</td>
        <td className={detailClass}>{formatDisplayAmount(sale.total_amount, sale.sale_currency || 'USD')}</td>
        <td className={detailClass} style={{ fontSize: detail ? undefined : '0.9em' }}>
          {renderDiscountCreditCell(sale, t)}
        </td>
        <td className={detailClass}>
          {uzsPay > 0 ? (
            <span style={{ color: sale.status === 'completed' ? '#4caf50' : 'inherit' }}>
              {uzsPay.toLocaleString()} UZS
            </span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td className={detailClass}>
          {usdPay > 0 ? (
            <span style={{ color: sale.status === 'completed' ? '#4caf50' : 'inherit' }}>${usdPay.toFixed(2)}</span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td className={detailClass}>{sale.customer_detail?.name || '-'}</td>
        <td className={detailClass}>{sale.customer_detail?.telephone || <span style={{ color: '#bbb' }}>—</span>}</td>
        <td className={detailClass}>{sale.salesman_detail?.username || '-'}</td>
        <td className={detailClass}>{renderDispatcherCell(sale)}</td>
      </>
    );
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      {notification.show && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: 9999,
            padding: '15px 25px',
            borderRadius: '8px',
            backgroundColor: notification.type === 'success' ? '#4caf50' : notification.type === 'error' ? '#f44336' : '#2196f3',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          <span style={{ fontSize: '20px' }}>
            {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification({ show: false, message: '', type: 'success' })}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0',
              lineHeight: '1',
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="page-header">
        <PageTitle ns="sales" />
        {canBatchCreate && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowBatchForm(true);
              setBatchCustomer('');
              setBatchDefaults({
                sale_type: 'bought_from_shop',
                sale_currency: 'USD',
              });
              setBatchLines([emptyBatchLine(`${Date.now()}-0`)]);
              setScanFeedback(null);
              // Chrome keeps an AudioContext suspended until the page has been interacted with.
              // This click is that interaction, so the first scan of the day still beeps.
              primeScanBeep();
            }}
          >
            {`+ ${t('newSale')}`}
          </button>
        )}
      </div>

      <Modal
        open={showDispatchForm}
        onClose={closeDispatchForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        title={t('dispatch.title')}
      >
          <BusyForm onSubmit={handleDispatchSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('dispatch.type')}</label>
                <select
                  value={dispatchFormData.dispatch_type}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDispatchFormData({
                      ...dispatchFormData,
                      dispatch_type: v,
                      dispatcher: v === 'dostavshik' ? dispatchFormData.dispatcher : '',
                    });
                  }}
                  required
                >
                  <option value="dostavshik">{t('dispatch.dostavshik')}</option>
                  <option value="bts">{t('dispatch.bts')}</option>
                </select>
                <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#555' }}>
                  {t('dispatch.typeHint')}
                </p>
              </div>
              {dispatchFormData.dispatch_type === 'dostavshik' && (
                <div className="form-group">
                  <label>{t('dispatch.dispatcher')}</label>
                  <FormSearchableSelect
                    value={dispatchFormData.dispatcher}
                    onChange={(v) => setDispatchFormData({ ...dispatchFormData, dispatcher: v })}
                    options={dispatchersList.map((d) => ({ value: String(d.id), label: d.name }))}
                    emptyLabel={t('dispatch.selectDispatcher')}
                    placeholder={t('dispatch.selectDispatcher')}
                    aria-label={t('dispatch.dispatcher')}
                  />
                </div>
              )}
              <div className="form-group">
                <label>{t('dispatch.currency')}</label>
                <select
                  value={dispatchFormData.currency}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, currency: e.target.value })}
                  required
                >
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('dispatch.deliveryCost', { currency: dispatchFormData.currency })}</label>
                <AmountInput
                  value={dispatchFormData.delivery_cost}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, delivery_cost: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('dispatch.tracking')}</label>
                <input
                  type="text"
                  value={dispatchFormData.tracking_number}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, tracking_number: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('dispatch.notesOptional')}</label>
                <textarea
                  rows={3}
                  value={dispatchFormData.dispatch_notes}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, dispatch_notes: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dispatchFormData.is_paid}
                    onChange={(e) => setDispatchFormData({ ...dispatchFormData, is_paid: e.target.checked })}
                  />
                  {t('dispatch.paymentMade')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('dispatch.create')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeDispatchForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <Modal
        open={showCompleteFromOrderForm}
        onClose={closeCompleteFromOrderForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        title={t('completeFromOrder.title', { id: completeFromOrderData.saleId })}
      >
          {(() => {
            const cfoSale = sales.find((s) => s.id === completeFromOrderData.saleId);
            if (!cfoSale) return null;
            return (
              <p style={{ margin: '0 0 12px', color: '#4a5568', fontSize: '0.9em' }}>
                {t('completeFromOrder.qty')}:{' '}
                {renderSaleQuantityCell(cfoSale.quantity, cfoSale.order_ordered_quantity, t)}
              </p>
            );
          })()}
          <BusyForm onSubmit={handleCompleteFromOrderSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('completeFromOrder.saleType')}</label>
                <select
                  value={completeFromOrderData.sale_type}
                  onChange={(e) => {
                    const newSaleType = e.target.value;
                    setCompleteFromOrderData({
                      ...completeFromOrderData,
                      sale_type: newSaleType,
                      // Reset deposit fields if not reserved
                      deposit_received: newSaleType === 'reserved' ? completeFromOrderData.deposit_received : false,
                      deposit_amount: newSaleType === 'reserved' ? completeFromOrderData.deposit_amount : '',
                    });
                  }}
                  required
                >
                  <option value="bought_from_shop">{t('saleTypes.bought_from_shop')}</option>
                  <option value="delivery">{t('saleTypes.delivery')}</option>
                  <option value="reserved">{t('saleTypes.reserved')}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('completeFromOrder.sellingPrice')}</label>
                <AmountInput
                  value={completeFromOrderData.selling_price ?? ''}
                  onChange={(e) => {
                    setCompleteFromOrderData({
                      ...completeFromOrderData,
                      selling_price: e.target.value,
                    });
                  }}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('completeFromOrder.advanceAuto')}</label>
                <input
                  type="text"
                  value={(() => {
                    const saleRow = sales.find((s) => s.id === completeFromOrderData.saleId);
                    const adv = saleRow?.advance_payment_received;
                    if (adv == null || adv === '') return '';
                    return formatDisplayAmount(adv, getAdvanceCurrency(saleRow));
                  })()}
                  readOnly
                  style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                />
              </div>
              {/* Deposit fields for Reserved sales */}
              {completeFromOrderData.sale_type === 'reserved' && (
                <>
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={completeFromOrderData.deposit_received}
                        onChange={(e) => {
                          const depositReceived = e.target.checked;
                          const sale = sales.find(s => s.id === completeFromOrderData.saleId);
                          const sellingPrice = parseFloat(completeFromOrderData.selling_price) || 0;
                          const advancePayment = sale?.advance_payment_received || 0;
                          const depositAmount = depositReceived ? parseFloat(completeFromOrderData.deposit_amount || 0) : 0;
                          const totalAmount = sellingPrice * (sale?.quantity || 1);
                          const nowPaid = totalAmount - advancePayment - depositAmount;
                          setCompleteFromOrderData({
                            ...completeFromOrderData,
                            deposit_received: depositReceived,
                            now_paid_amount: nowPaid > 0 ? nowPaid.toFixed(2) : '0',
                          });
                        }}
                      />
                      {' '}{t('completeFromOrder.customerDeposited')}
                    </label>
                  </div>
                  {completeFromOrderData.deposit_received && (
                    <>
                      <div className="form-group">
                        <label>{t('completeFromOrder.depositAmount')}</label>
                        <AmountInput
                          value={completeFromOrderData.deposit_amount ?? ''}
                          onChange={(e) => {
                            const depositAmount = parseFloat(e.target.value) || 0;
                            const sale = sales.find(s => s.id === completeFromOrderData.saleId);
                            const sellingPrice = parseFloat(completeFromOrderData.selling_price) || 0;
                            const advancePayment = sale?.advance_payment_received || 0;
                            const totalAmount = sellingPrice * (sale?.quantity || 1);
                            const nowPaid = totalAmount - advancePayment - depositAmount;
                            setCompleteFromOrderData({
                              ...completeFromOrderData,
                              deposit_amount: e.target.value,
                              now_paid_amount: nowPaid > 0 ? nowPaid.toFixed(2) : '0',
                            });
                          }}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('completeFromOrder.depositCurrency')}</label>
                        <select
                          value={completeFromOrderData.deposit_currency}
                          onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, deposit_currency: e.target.value })}
                          required
                        >
                          <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                          <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                        </select>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="form-group">
                <label>{t('completeFromOrder.packagesOptional')}</label>
                <PackageLinesSelector
                  lines={completeFromOrderPackageLines}
                  onChange={setCompleteFromOrderPackageLines}
                  packages={packages}
                />
              </div>
              {completeFromOrderData.sale_type === 'delivery' ? (
                // The courier collects a delivery sale at settlement, where the due is
                // computed and any shortfall is classified. Money taken here would never
                // reach Money Balance and would be invisible to that calculation.
                <div className="form-group" style={{ gridColumn: '1 / -1', borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '4px' }}>
                  <p style={{ margin: 0, color: '#555', fontSize: '0.9em', lineHeight: 1.5 }}>
                    {t('completeFromOrder.deliveryPaymentLater')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="form-group" style={{ gridColumn: '1 / -1', borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '4px' }}>
                    <p style={{ margin: '0 0 10px 0', color: '#555', fontSize: '0.9em', fontWeight: 600 }}>
                      {t('completeFromOrder.paymentHint')}
                    </p>
                    {cfoExchangeRate?.label && (
                      <p style={{ margin: '0 0 8px', color: '#4a5568', fontSize: '0.85em' }}>{cfoExchangeRate.label}</p>
                    )}
                    {cfoExchangeRateError && (
                      <p style={{ margin: '0 0 8px', color: '#b45309', fontSize: '0.85em' }}>{cfoExchangeRateError}</p>
                    )}
                  </div>
                  <div className="form-group">
                    <label>{t('currency.uzs', { ns: 'common' })}</label>
                    <AmountInput placeholder="0"
                      value={completeFromOrderData.now_uzs ?? ''}
                      onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, now_uzs: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>{t('currency.usd', { ns: 'common' })}</label>
                    <AmountInput placeholder="0"
                      value={completeFromOrderData.now_usd ?? ''}
                      onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, now_usd: e.target.value })} />
                  </div>
                </>
              )}
              {(() => {
                if (completeFromOrderData.sale_type === 'delivery') return null;
                const saleRow = sales.find((s) => s.id === completeFromOrderData.saleId);
                if (!saleHasOrderAdvance(saleRow)) return null;
                const remaining = computeAdvanceRemainingDue(
                  saleRow,
                  completeFromOrderData.selling_price,
                  cfoExchangeRate?.rate ?? null,
                );
                const sc = (saleRow?.sale_currency || 'USD').toUpperCase();
                const otherCurrency = sc === 'USD' ? t('currency.uzs', { ns: 'common' }) : t('currency.usd', { ns: 'common' });
                return (
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <p style={{ margin: 0, fontSize: '0.9em', color: '#444' }}>
                      <strong>{t('completeFromOrder.remainingDue')}</strong>{' '}
                      {remaining == null
                        ? (cfoExchangeRateError || t('completePay.errCbuRate'))
                        : formatDisplayAmount(remaining, sc)}
                      {remaining != null ? (
                        <>
                          {' '}
                          {t('completeFromOrder.remainingHint', { currency: sc, otherCurrency })}
                        </>
                      ) : null}
                    </p>
                  </div>
                );
              })()}
              {(() => {
                // Keyed off the gross surplus, not `isUnderpaidMeta`: once the change covers the
                // surplus the payment reads as exact, which would pull the panel out from under
                // the amounts just typed.
                if (completeFromOrderData.sale_type !== 'bought_from_shop') return null;
                const saleRow = sales.find((s) => s.id === completeFromOrderData.saleId);
                if (!saleRow) return null;
                const meta = cfoMetaFor(saleRow, completeFromOrderData);
                const tol = meta.sc === 'UZS' ? 1 : 0.005;
                if (
                  !completeFromOrderData.apply_change
                  && !(meta.requiredChange != null && meta.requiredChange > tol)
                ) return null;
                return (
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <SaleChangeFields
                      form={completeFromOrderData}
                      setForm={setCompleteFromOrderData}
                      sc={meta.sc}
                      required={meta.requiredChange}
                      cbuRate={cfoExchangeRate?.rate ?? null}
                      t={t}
                    />
                  </div>
                );
              })()}
              {(() => {
                // Paying less than due has to be explained here, or the gap silently becomes
                // customer debt and never reaches the FX-difference report.
                if (completeFromOrderData.sale_type !== 'bought_from_shop') return null;
                const saleRow = sales.find((s) => s.id === completeFromOrderData.saleId);
                if (!saleRow) return null;
                const meta = cfoMetaFor(saleRow, completeFromOrderData);
                if (!isUnderpaidMeta(meta)) return null;
                return (
                  <div
                    className="form-group"
                    style={{
                      gridColumn: '1 / -1',
                      borderTop: '1px solid #eee',
                      paddingTop: '12px',
                      marginTop: '4px',
                    }}
                  >
                    <ShortfallClassificationFields
                      form={completeFromOrderData}
                      setForm={setCompleteFromOrderData}
                      meta={meta}
                      t={t}
                      allowCredit
                    />
                  </div>
                );
              })()}
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('completeSale')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeCompleteFromOrderForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <Modal
        open={showCompleteFromOrderGroupForm}
        onClose={closeCompleteFromOrderGroupForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        width={WIDE}
        title={t('completeFromOrder.titleGroup', { count: completeFromOrderGroupData.lines.length })}
      >
          <BusyForm onSubmit={handleCompleteFromOrderGroupSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('completeFromOrder.saleType')}</label>
                <select
                  value={completeFromOrderGroupData.sale_type}
                  onChange={(e) => {
                    const newSaleType = e.target.value;
                    setCompleteFromOrderGroupData((prev) => ({
                      ...prev,
                      sale_type: newSaleType,
                      deposit_received: newSaleType === 'reserved' ? prev.deposit_received : false,
                      deposit_amount: newSaleType === 'reserved' ? prev.deposit_amount : '',
                    }));
                  }}
                  required
                >
                  <option value="bought_from_shop">{t('saleTypes.bought_from_shop')}</option>
                  <option value="delivery">{t('saleTypes.delivery')}</option>
                  <option value="reserved">{t('saleTypes.reserved')}</option>
                </select>
              </div>
              {completeFromOrderGroupData.sale_type === 'reserved' && (
                <>
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={completeFromOrderGroupData.deposit_received}
                        onChange={(e) => setCompleteFromOrderGroupData((prev) => ({
                          ...prev, deposit_received: e.target.checked,
                        }))}
                      />
                      {' '}{t('completeFromOrder.customerDeposited')}
                    </label>
                  </div>
                  {completeFromOrderGroupData.deposit_received && (
                    <>
                      <div className="form-group">
                        <label>{t('completeFromOrder.depositAmount')}</label>
                        <AmountInput
                          value={completeFromOrderGroupData.deposit_amount ?? ''}
                          onChange={(e) => setCompleteFromOrderGroupData((prev) => ({
                            ...prev, deposit_amount: e.target.value,
                          }))}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('completeFromOrder.depositCurrency')}</label>
                        <select
                          value={completeFromOrderGroupData.deposit_currency}
                          onChange={(e) => setCompleteFromOrderGroupData((prev) => ({
                            ...prev, deposit_currency: e.target.value,
                          }))}
                          required
                        >
                          <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                          <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                        </select>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            {completeFromOrderGroupData.sale_type === 'delivery' ? (
              <p style={{ margin: '4px 0 8px', color: '#555', fontSize: '0.9em', lineHeight: 1.5 }}>
                {t('completeFromOrder.deliveryPaymentLater')}
              </p>
            ) : (
              <>
                <p style={{ margin: '4px 0 8px', color: '#555', fontSize: '0.9em', fontWeight: 600 }}>
                  {t('completeFromOrder.paymentHint')}
                </p>
                {cfoGroupExchangeRate?.label && (
                  <p style={{ margin: '0 0 8px', color: '#4a5568', fontSize: '0.85em' }}>{cfoGroupExchangeRate.label}</p>
                )}
                {cfoGroupExchangeRateError && (
                  <p style={{ margin: '0 0 8px', color: '#b45309', fontSize: '0.85em' }}>{cfoGroupExchangeRateError}</p>
                )}
              </>
            )}
            <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll" style={{ marginBottom: 16 }}>
              <table className="batch-sale-lines" role="table">
                <thead>
                  <tr>
                    <th scope="col">{t('batch.product', { ns: 'sales' })}</th>
                    <th className="batch-sale-lines__th--num">{t('completeFromOrder.qty')}</th>
                    <th className="batch-sale-lines__th--num">{t('completeFromOrder.sellingPrice')}</th>
                    <th className="batch-sale-lines__th--num">{t('completeFromOrder.advanceAuto')}</th>
                    <th scope="col">{t('completeFromOrder.packagesOptional')}</th>
                    <th className="batch-sale-lines__th--num">{t('currency.uzs', { ns: 'common' })}</th>
                    <th className="batch-sale-lines__th--num">{t('currency.usd', { ns: 'common' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {completeFromOrderGroupData.lines.map((line) => (
                    <tr key={line.saleId}>
                      <td>
                        #{line.saleId} — {line.product_detail?.brand} {line.product_detail?.model}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        {renderSaleQuantityCell(line.quantity, line.orderedQuantity, t)}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        <AmountInput
                          className="batch-sale-lines__control"
                          value={line.selling_price ?? ''}
                          onChange={(e) => updateCompleteFromOrderGroupLine(line.saleId, 'selling_price', e.target.value)}
                        />
                      </td>
                      <td className="batch-sale-lines__td--num">
                        <input
                          className="batch-sale-lines__control"
                          type="text"
                          value={line.advanceDisplay ?? ''}
                          readOnly
                          style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                        />
                      </td>
                      <td style={{ minWidth: '220px' }}>
                        <PackageLinesSelector
                          lines={line.packageLines || EMPTY_PKG_LINES()}
                          onChange={(newLines) => updateCompleteFromOrderGroupLine(line.saleId, 'packageLines', newLines)}
                          packages={packages}
                        />
                      </td>
                      {/* Delivery lines are collected by the courier at settlement, so there
                          is nothing to take here (see deliveryPaymentLater note above). */}
                      <td className="batch-sale-lines__td--num">
                        {completeFromOrderGroupData.sale_type === 'delivery' ? '—' : (
                          <AmountInput
                            className="batch-sale-lines__control"
                            placeholder="0"
                            value={line.uzs ?? ''}
                            onChange={(e) => updateCompleteFromOrderGroupLine(line.saleId, 'uzs', e.target.value)}
                          />
                        )}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        {completeFromOrderGroupData.sale_type === 'delivery' ? '—' : (
                          <AmountInput
                            className="batch-sale-lines__control"
                            placeholder="0"
                            value={line.usd ?? ''}
                            onChange={(e) => updateCompleteFromOrderGroupLine(line.saleId, 'usd', e.target.value)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {completeFromOrderGroupData.sale_type === 'bought_from_shop'
              && completeFromOrderGroupData.lines.map((line) => {
                // Lines settle independently, so each one is classified — and given change —
                // on its own rather than lumping the group's total gap into one figure.
                const saleRow = sales.find((s) => s.id === line.saleId);
                if (!saleRow) return null;
                const meta = cfoMetaFor(saleRow, line, true);
                const setLine = (updater) => {
                  setCompleteFromOrderGroupData((prev) => ({
                    ...prev,
                    lines: prev.lines.map((l) => (
                      l.saleId === line.saleId
                        ? (typeof updater === 'function' ? updater(l) : { ...l, ...updater })
                        : l
                    )),
                  }));
                };
                const tol = meta.sc === 'UZS' ? 1 : 0.005;
                const showChange = !!line.apply_change
                  || (meta.requiredChange != null && meta.requiredChange > tol);
                const showShortfall = isUnderpaidMeta(meta);
                if (!showChange && !showShortfall) return null;
                return (
                  <div
                    key={`cfo-group-shortfall-${line.saleId}`}
                    style={{
                      borderTop: '1px solid #eee',
                      paddingTop: '12px',
                      marginTop: '12px',
                    }}
                  >
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.9em' }}>
                      #{line.saleId} — {line.product_detail?.brand} {line.product_detail?.model}
                    </p>
                    {showChange && (
                      <SaleChangeFields
                        form={line}
                        setForm={setLine}
                        sc={meta.sc}
                        required={meta.requiredChange}
                        cbuRate={cfoGroupExchangeRate?.rate ?? null}
                        t={t}
                      />
                    )}
                    {showShortfall && (
                      <ShortfallClassificationFields
                        form={line}
                        setForm={setLine}
                        meta={meta}
                        t={t}
                        allowCredit
                      />
                    )}
                  </div>
                );
              })}
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('completeSale')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeCompleteFromOrderGroupForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      {completePaySale && shopDeliverySettlementRequiredForGroup(completePaySale) && (
        <SaleDeliverySettlementForm
          sale={completePaySale}
          onClose={() => setCompletePaySale(null)}
          onAfterStepRecorded={() => fetchSales()}
          onSuccess={() => {
            setCompletePaySale(null);
            fetchSales();
          }}
          showNotification={showNotification}
        />
      )}
      {completePaySale && !shopDeliverySettlementRequiredForGroup(completePaySale) && (
        <SaleCompletePayForm
          sale={completePaySale}
          onClose={() => setCompletePaySale(null)}
          onSuccess={() => {
            setCompletePaySale(null);
            fetchSales();
          }}
          showNotification={showNotification}
        />
      )}

      <Modal
        open={showSellReservedForm}
        onClose={closeSellReservedForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        title={t('sellReserved.title', { id: sellReservedData.saleId })}
      >
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('sellReserved.intro')}
          </p>
          <BusyForm onSubmit={handleSellReservedSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('currency.uzs', { ns: 'common' })}</label>
                <AmountInput placeholder="0"
                  value={sellReservedData.uzs ?? ''}
                  onChange={(e) => setSellReservedData({ ...sellReservedData, uzs: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('currency.usd', { ns: 'common' })}</label>
                <AmountInput placeholder="0"
                  value={sellReservedData.usd ?? ''}
                  onChange={(e) => setSellReservedData({ ...sellReservedData, usd: e.target.value })} />
              </div>
              {sellReservedPayMeta.needsRate && (
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.9em', color: '#c05621' }}>
                  {sellReservedExchangeRateError || t('sellReserved.loadingCbu')}
                </p>
              )}
              {sellReservedSaleForForm && !sellReservedPayMeta.needsRate && (
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.9em', color: '#444' }}>
                  <strong>{t('sellReserved.balanceDue')}</strong>{' '}
                  {formatDisplayAmount(
                    (sellReservedSaleForForm.deposit_received
                      ? parseFloat(sellReservedSaleForForm.total_amount || 0) -
                        parseFloat(sellReservedSaleForForm.deposit_amount || 0)
                      : parseFloat(sellReservedSaleForForm.total_amount || 0)),
                    sellReservedPayMeta.sc,
                  )}
                  {sellReservedPayMeta.paid != null &&
                  (parseFloat(sellReservedData.uzs) || parseFloat(sellReservedData.usd)) ? (
                    <>
                      {' '}
                      ·{' '}
                      <strong>
                        {sellReservedPayMeta.splitCurrency || sellReservedPayMeta.crossCurrency
                          ? t('sellReserved.totalAtCbu', { currency: sellReservedPayMeta.sc })
                          : t('sellReserved.entered', { currency: sellReservedPayMeta.sc })}
                      </strong>{' '}
                      {formatDisplayAmount(sellReservedPayMeta.paid, sellReservedPayMeta.sc)}
                    </>
                  ) : null}
                </p>
              )}
              {sellReservedChangeAvailable && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <SaleChangeFields
                    form={sellReservedData}
                    setForm={setSellReservedData}
                    sc={sellReservedPayMeta.sc}
                    required={sellReservedPayMeta.requiredChange}
                    cbuRate={sellReservedExchangeRate?.rate ?? null}
                    t={t}
                  />
                </div>
              )}
              {sellReservedPayMeta.needsDiscountChoice && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
                    {t('completePay.shortfallHint')}
                  </p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sellReservedData.balance_shortfall_type === 'discount'}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const def =
                          sellReservedPayMeta.short > 0
                            ? (sellReservedPayMeta.sc === 'UZS'
                              ? String(Math.round(sellReservedPayMeta.short))
                              : sellReservedPayMeta.short.toFixed(2))
                            : '';
                        setSellReservedData({
                          ...sellReservedData,
                          balance_shortfall_type: checked ? 'discount' : '',
                          balance_shortfall_amount: checked
                            ? (sellReservedData.balance_shortfall_amount || def)
                            : '',
                        });
                      }}
                    />
                    <span>{t('completePay.discountOption')}</span>
                  </label>
                  {sellReservedData.balance_shortfall_type === 'discount' && (
                    <div style={{ marginTop: 10, maxWidth: 280 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                        {t('completePay.discountAmountLabel', { currency: sellReservedPayMeta.sc })}
                      </label>
                      <AmountInput
                        step={sellReservedPayMeta.sc === 'UZS' ? '1' : '0.01'}
                        value={sellReservedData.balance_shortfall_amount ?? ''}
                        onChange={(e) =>
                          setSellReservedData({
                            ...sellReservedData,
                            balance_shortfall_amount: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={!!sellReservedData.apply_currency_conversion_difference}
                      onChange={(e) =>
                        setSellReservedData({
                          ...sellReservedData,
                          apply_currency_conversion_difference: e.target.checked,
                        })
                      }
                    />
                    <span>{t('completePay.conversionDifferenceOption')}</span>
                  </label>
                </div>
              )}
              {/*
                Outside the shortfall block, and gated only on there being something owing: a
                reserved item taken wholly on credit is settled with no money at all, which the
                shortfall prompt never sees because it only appears once a payment has been
                typed and come up short.
              */}
              {sellReservedCreditAvailable && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!sellReservedData.apply_credit}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSellReservedData({
                          ...sellReservedData,
                          apply_credit: checked,
                          credit_amount: checked ? sellReservedData.credit_amount : '',
                          credit_due_date: checked ? sellReservedData.credit_due_date : '',
                        });
                      }}
                    />
                    <span>{t('completePay.creditOption')}</span>
                  </label>
                  {sellReservedData.apply_credit && (
                    <div style={{ marginTop: 10, maxWidth: 280 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                        {t('completePay.creditAmountLabel', { currency: sellReservedPayMeta.sc })}
                      </label>
                      <AmountInput
                        step={sellReservedPayMeta.sc === 'UZS' ? '1' : '0.01'}
                        placeholder={
                          sellReservedPayMeta.creditAmount
                            ? (sellReservedPayMeta.sc === 'UZS'
                              ? String(Math.round(sellReservedPayMeta.creditAmount))
                              : sellReservedPayMeta.creditAmount.toFixed(2))
                            : '0'
                        }
                        value={sellReservedData.credit_amount ?? ''}
                        onChange={(e) =>
                          setSellReservedData({ ...sellReservedData, credit_amount: e.target.value })
                        }
                      />
                      <small style={{ color: '#666', marginTop: 5, display: 'block' }}>
                        {t('completePay.creditAmountHint')}
                      </small>
                      <label style={{ display: 'block', marginTop: 10, marginBottom: 4, fontSize: '0.9em' }}>
                        {t('completePay.creditDueDateLabel')}
                      </label>
                      <input
                        type="date"
                        value={sellReservedData.credit_due_date ?? ''}
                        onChange={(e) =>
                          setSellReservedData({ ...sellReservedData, credit_due_date: e.target.value })
                        }
                        required
                      />
                      <small style={{ color: '#666', marginTop: 5, display: 'block' }}>
                        {t('completePay.creditDueDateHint')}
                      </small>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('completeSale')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeSellReservedForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>


      <Modal
        open={showBatchForm && canBatchCreate}
        onClose={() => { setShowBatchForm(false); setBatchLines([]); }}
        title={t('batch.title')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        width={WIDE}
      >
          <p style={{ color: '#555', fontSize: '0.9em', marginTop: 0, marginBottom: 16 }}>
            {t('batch.intro')}
          </p>
          <BusyForm onSubmit={handleBatchSubmit}>
            <div className="sales-batch-header-row">
              <div className="form-group">
                <label>{t('batch.customerRequired')}</label>
                <div className="sales-batch-header-row__customer">
                  <div className="sales-batch-header-row__customer-field">
                    <CustomerSearchableSelect
                      asyncSearch
                      customers={customers}
                      value={batchCustomer}
                      onChange={setBatchCustomer}
                      placeholder={t('batch.selectCustomer')}
                      emptyLabel={t('batch.selectCustomer')}
                      aria-label={t('batch.customerRequired')}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-edit sales-batch-header-row__customer-add"
                    onClick={() => setShowCustomerForm(true)}
                  >
                    + {t('actions.add', { ns: 'common' })}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>{t('batch.saleTypeAll')}</label>
                <select
                  value={batchDefaults.sale_type}
                  onChange={(e) => setBatchDefaults({ ...batchDefaults, sale_type: e.target.value })}
                >
                  <option value="bought_from_shop">{t('batch.boughtFromShop')}</option>
                  <option value="delivery">{t('saleTypes.delivery')}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('batch.currencyAll')}</label>
                <select
                  value={batchDefaults.sale_currency}
                  onChange={(e) => {
                    const nextCurrency = e.target.value;
                    const prevCurrency = batchDefaults.sale_currency || 'USD';
                    setBatchDefaults({ ...batchDefaults, sale_currency: nextCurrency });
                    if (nextCurrency === prevCurrency) return;
                    setBatchLines((lines) =>
                      lines.map((l) => {
                        if (!l.layer && !l.list_price && !l.selling_price && !l.discount_price) return l;
                        const convert = (val) => {
                          const num = parsePriceNum(val);
                          if (num == null) return val;
                          if (!batchCbuRate) return val;
                          const converted =
                            nextCurrency === 'UZS'
                              ? usdToUzs(num, batchCbuRate)
                              : uzsToUsd(num, batchCbuRate);
                          return formatSalePriceForCurrency(converted, nextCurrency);
                        };
                        return {
                          ...l,
                          list_price: convert(l.list_price),
                          selling_price: convert(l.selling_price),
                          discount_price: convert(l.discount_price),
                        };
                      })
                    );
                  }}
                >
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                </select>
                {!batchCbuRate && batchExchangeRateError && (
                  <small style={{ color: '#b45309', display: 'block', marginTop: '4px' }}>
                    {batchExchangeRateError}
                  </small>
                )}
              </div>
            </div>
            <div className="batch-sale-lines-block">
              <div className="batch-sale-lines-block__label" id="batch-line-items-label">
                {t('batch.lineItems')}
              </div>
              <div className="scan-strip">
                {/*
                  No input box. The scanner types straight into the page, and the modal opens with
                  focus on a button rather than a text field, so a scan is captured from the moment
                  the form appears — a box to click into first was a step that bought nothing.
                  The hint stays, because it is the only thing that says scanning is supported.
                */}
                <span className="scan-strip__hint">{t('batch.scanHint')}</span>
                <span
                  className={`scan-strip__feedback scan-strip__feedback--${scanFeedback?.kind || 'idle'}`}
                  role="status"
                  aria-live="polite"
                >
                  {scanFeedback?.text || ''}
                </span>
              </div>
              <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll">
                <table
                  className="batch-sale-lines"
                  role="table"
                  aria-labelledby="batch-line-items-label"
                >
                  <colgroup>
                    <col className="batch-col-category" />
                    <col className="batch-col-product" />
                    <col className="batch-col-stock" />
                    <col className="batch-col-qty" />
                    <col className="batch-col-price" />
                    <col className="batch-col-price" />
                    <col className="batch-col-package" />
                    <col className="batch-col-row" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{t('batch.filterCategory')}</th>
                      <th scope="col">{t('batch.product')}</th>
                      <th className="batch-sale-lines__th--num" title={t('batch.stock')}>
                        {t('batch.stock')}
                      </th>
                      <th className="batch-sale-lines__th--num">{t('batch.qty')}</th>
                      <th className="batch-sale-lines__th--num">{t('batch.sellingPrice')}</th>
                      <th className="batch-sale-lines__th--num">{t('batch.discountPrice')}</th>
                      <th>{t('batch.packages')}</th>
                      <th className="batch-sale-lines__th--action" aria-label={t('actions.delete', { ns: 'common' })} />
                    </tr>
                  </thead>
                  <tbody>
                    {batchLines.map((line) => {
                      const layer = line.layer ? findInventoryLayer(inventory, line.layer) : null;
                      const stock = layer ? Number(layer.quantity) || 0 : null;
                      const linePickerItems = batchLayerPickerItemsForCategory(line.category || '');
                      return (
                        <tr key={line.key}>
                          <td>
                            <FormSearchableSelect
                              value={line.category || ''}
                              onChange={(v) => updateBatchLine(line.key, 'category', v)}
                              options={batchCategoryOptions}
                              emptyLabel={t('batch.allCategories')}
                              placeholder={t('batch.allCategories')}
                              aria-label={t('batch.filterCategory')}
                              triggerClassName="batch-sale-lines__control"
                            />
                          </td>
                          <td>
                            <ProductSearchableSelect
                              pickerItems={linePickerItems}
                              value={line.layer ?? ''}
                              onChange={(id) => updateBatchLine(line.key, 'layer', id)}
                              triggerClassName="batch-sale-lines__control"
                              placeholder={t('batch.productPlaceholder')}
                              aria-label={t('batch.product')}
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            {line.layer ? stock : <span className="batch-sale-lines__empty" aria-hidden>—</span>}
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <input
                              className="batch-sale-lines__control"
                              type="number"
                              min="1"
                              value={line.quantity ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'quantity', e.target.value)}
                              title={t('batch.qty')}
                              aria-label={t('batch.qty')}
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <AmountInput
                              className="batch-sale-lines__control"
                              value={line.selling_price ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'selling_price', e.target.value)}
                              title={t('batch.sellingPrice')}
                              placeholder="0.00"
                              aria-label={t('batch.sellingPrice')}
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <AmountInput
                              className="batch-sale-lines__control"
                              value={line.discount_price ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'discount_price', e.target.value)}
                              title={t('batch.discountPrice')}
                              placeholder="0.00"
                              aria-label={t('batch.discountPrice')}
                            />
                          </td>
                          <td style={{ minWidth: '260px', verticalAlign: 'top', paddingTop: '6px' }}>
                            <PackageLinesSelector
                              lines={line.packageLines || EMPTY_PKG_LINES()}
                              onChange={(newLines) => updateBatchLine(line.key, 'packageLines', newLines)}
                              packages={packages}
                            />
                          </td>
                          <td className="batch-sale-lines__td--action">
                            {batchLines.length > 1 ? (
                              <button
                                type="button"
                                className="batch-sale-lines__remove"
                                onClick={() => removeBatchLine(line.key)}
                                title={t('actions.delete', { ns: 'common' })}
                                aria-label={t('actions.delete', { ns: 'common' })}
                              >
                                ×
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="form-actions batch-sale-lines-actions">
              <button type="button" className="btn-edit" onClick={addBatchLine}>
                + {t('batch.addLine')}
              </button>
              <SubmitButton className="btn-primary">
                {t('batch.createCount', { count: batchLines.filter((l) => l.layer).length })}
              </SubmitButton>
              <button
                type="button"
                className="btn-edit"
                onClick={() => { setShowBatchForm(false); setBatchLines([]); }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <Modal
        open={showCustomerForm}
        onClose={closeCustomerForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        title={t('customer.addTitle')}
      >
          <BusyForm onSubmit={handleCreateCustomer}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('customer.name')} *</label>
                <input
                  type="text"
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('customer.telephone')} *</label>
                <input
                  type="text"
                  value={newCustomerData.telephone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, telephone: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('customer.instagram')}</label>
                <input
                  type="text"
                  value={newCustomerData.instagram}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, instagram: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('customer.region')}</label>
                <select
                  value={newCustomerData.region}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, region: e.target.value })}
                >
                  {regionChoices.map((region) => (
                    <option key={region.value} value={region.value}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('customer.addButton')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeCustomerForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      {/* Filters. The long list of "not while this form is open" guards went with the cards:
          a dialog covers the page by itself, so the filters just stay put. */}
      {(
        <FilterPanel title={t('filters.title', { ns: 'common' })} filters={filters} style={{ marginBottom: '16px' }}>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('table.categoryType')}</label>
            <select
              value={filters.category_type}
              onChange={(e) => setFilters({ ...filters, category_type: e.target.value })}
            >
              <option value="">{t('filters.allTypes')}</option>
              {productCategoryTypes.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </div>
          <ProductCatalogFilterFields
            filters={filters}
            onFiltersChange={setFilters}
            options={getCascadedFilterOptions(sales, filters, (s) => s.product_detail, null, (sale, _excl) => {
              if (filters.year) {
                const y = new Date(sale.sale_date).getFullYear().toString();
                if (y !== filters.year) return false;
              }
              if (filters.month) {
                const m = (new Date(sale.sale_date).getMonth() + 1).toString();
                if (m !== filters.month) return false;
              }
              return true;
            })}
            t={t}
            fieldLabels={{
              category: t('table.category'),
              brand: t('table.brand'),
              model: t('table.model'),
              size: t('table.size'),
              color: t('table.color'),
            }}
            emptyLabels={{
              category: t('filters.allCategories'),
              brand: t('filters.allBrands'),
              model: t('filters.allModels'),
              size: t('filters.allSizes'),
              color: t('filters.allColors'),
            }}
          />
          <div className="filter-field">
            <label>{t('table.status', { ns: 'common' })}</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{t('filters.allStatuses')}</option>
              {['pending', 'reserved', 'confirmed', 'dispatched', 'completed', 'returned', 'cancelled'].map((st) => (
                <option key={st} value={st}>
                  {tStatus(st, 'sale')}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('table.saleType')}</label>
            <select
              value={filters.sale_type}
              onChange={(e) => setFilters({ ...filters, sale_type: e.target.value })}
            >
              <option value="">{t('filters.allSaleTypes')}</option>
              {['bought_from_shop', 'delivery', 'reserved', 'from_order'].map((st) => (
                <option key={st} value={st}>
                  {t(`saleTypes.${st}`, { ns: 'sales' })}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('table.customer')}</label>
            <CustomerSearchableSelect
              variant="filter"
              customers={customerFilterOptions}
              value={filters.customer}
              allowEmpty
              emptyLabel={t('filters.allCustomers')}
              placeholder={t('filters.allCustomers')}
              extraOptions={[{ value: '__none__', label: t('filters.noCustomer') }]}
              aria-label={t('table.customer')}
              onChange={(customerId) => setFilters({ ...filters, customer: customerId })}
            />
          </div>
          {(() => {
            const dateOpts = getCascadedDateOptions(sales, filters, (s) => s.sale_date, (s) => s.product_detail);
            return (
              <>
                <div className="filter-field">
                  <label>{t('filters.year', { ns: 'common' })}</label>
                  <select
                    value={filters.year}
                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                  >
                    <option value="">{t('filters.allYears', { ns: 'common' })}</option>
                    {dateOpts.years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>{t('filters.month', { ns: 'common' })}</label>
                  <select
                    value={filters.month}
                    onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                  >
                    <option value="">{monthOptions[0]?.label || t('filters.allMonths', { ns: 'common' })}</option>
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
                  status: '',
                  sale_type: '',
                  customer: '',
                  year: '',
                  month: '',
                })
              }
            >
              {t('actions.clearAll', { ns: 'common' })}
            </button>
          </div>
        </div>
        </FilterPanel>
      )}

      <div className="table-card">
        <div className="table-card__toolbar">
          <TableDownloadButton
            tableRef={tableRef}
            filename="sotuvlar"
            rowCount={filteredSales.length}
          />
        </div>
        <div className="data-table-scroll">
        <table className="data-table" ref={tableRef}>
          <thead>
            <tr>
              <SortableTh columnId="id" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.id', { ns: 'common' })}</SortableTh>
              <SortableTh columnId="sale_date" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.date', { ns: 'common' })}</SortableTh>
              <th>{t('table.actions', { ns: 'sales' })}</th>
              <SortableTh columnId="status" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.status', { ns: 'common' })}</SortableTh>
              <SortableTh columnId="category_type" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.categoryType')}</SortableTh>
              <SortableTh columnId="category" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.category')}</SortableTh>
              <SortableTh columnId="brand" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.brand')}</SortableTh>
              <SortableTh columnId="model" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.model')}</SortableTh>
              <SortableTh columnId="size" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.size')}</SortableTh>
              <SortableTh columnId="color" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.color')}</SortableTh>
              <SortableTh columnId="sale_type" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.saleType')}</SortableTh>
              <SortableTh columnId="package" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.package')}</SortableTh>
              <SortableTh columnId="quantity" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.quantity')}</SortableTh>
              <SortableTh columnId="selling_price" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.price')}</SortableTh>
              <SortableTh columnId="total_amount" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.total')}</SortableTh>
              <SortableTh columnId="discount_credit" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.discountCredit')}</SortableTh>
              <SortableTh columnId="uzs_pay" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('currency.uzs', { ns: 'common' })}</SortableTh>
              <SortableTh columnId="usd_pay" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('currency.usd', { ns: 'common' })}</SortableTh>
              <SortableTh columnId="customer" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.customer')}</SortableTh>
              <SortableTh columnId="phone" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.phone')}</SortableTh>
              <SortableTh columnId="salesman" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.salesman')}</SortableTh>
              <SortableTh columnId="dispatcher" sortCol={saleSort.sortCol} sortDir={saleSort.sortDir} onSort={saleSort.onHeaderClick}>{t('table.dispatcher')}</SortableTh>
            </tr>
          </thead>
          <tbody>
            {filteredSales.length === 0 ? (
              <tr>
                <td colSpan={SALES_TABLE_COLUMN_COUNT} style={{ textAlign: 'center' }}>
                  {t('noSales', { ns: 'sales' })}
                </td>
              </tr>
            ) : (
              sortedDisplayRows.map((row) => {
                if (row.type === 'single') {
                  const sale = row.sale;
                  return (
                    <tr key={row.key} style={{ backgroundColor: saleRowBackground(sale) }}>
                      <td>#{sale.id}</td>
                      <td>{formatAppDateTime(sale.display_date || sale.sale_date)}</td>
                      <td>{renderSaleActionsCell(sale)}</td>
                      {renderSaleProductCells(sale)}
                    </tr>
                  );
                }

                const agg = aggregateGroupSales(row.sales);
                const sale = agg.first;
                const expanded = expandedSaleGroups.has(row.groupId);
                const saleTypeLabel = sale?.sale_type ? t(`saleTypes.${sale.sale_type}`, { ns: 'sales' }) : '—';
                const flagged = row.sales.find((s) => saleRowBackground(s));
                const groupBg = flagged ? saleRowBackground(flagged) : undefined;

                return (
                  <React.Fragment key={row.key}>
                    <tr
                      className="sale-group-row"
                      style={{ backgroundColor: groupBg, cursor: 'pointer' }}
                      onClick={(e) => {
                        if (e.target.closest('button')) return;
                        toggleSaleGroup(row.groupId);
                      }}
                    >
                      <td>{agg.idsLabel}</td>
                      <td>{sale ? formatAppDateTime(sale.sale_date) : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>{renderSaleActionsCell(sale, row.sales)}</td>
                      <td>
                        {(() => {
                          const groupStatus = groupDisplayStatus(agg);
                          return (
                            <span className={`status-badge ${groupStatus}`}>
                              {groupStatus === 'mixed' ? t('mixed') : tStatus(groupStatus, 'sale')}
                            </span>
                          );
                        })()}
                        {/* A refused item no longer renames the group, so say so here instead —
                            otherwise "Yakunlandi" would hide that one item came back. */}
                        {agg.declinedCount > 0 && (
                          <small style={{ display: 'block', color: '#b45309', marginTop: 2 }}>
                            {t('deliverySettlement.declinedCountBadge', {
                              ns: 'sales', count: agg.declinedCount,
                            })}
                          </small>
                        )}
                      </td>
                      <td><span style={{ color: '#999' }}>—</span></td>
                      <td>
                        <strong>{t('multipleItems')}</strong>
                        <span style={{ color: '#666', fontSize: '0.85em' }}> ({row.sales.length})</span>
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>{saleTypeLabel}</td>
                      <td><span style={{ color: '#bbb' }}>—</span></td>
                      <td>{agg.quantity}</td>
                      <td>—</td>
                      <td>
                        {agg.saleCurrency
                          ? formatDisplayAmount(agg.totalAmount, agg.saleCurrency)
                          : formatPlainAmount(agg.totalAmount)}
                      </td>
                      <td style={{ fontSize: '0.9em' }}>
                        {renderDiscountCreditCell(
                          {
                            total_discount_amount: agg.totalDiscount,
                            balance_shortfall_type:
                              agg.completionDiscount > 0 ? 'discount' : sale?.balance_shortfall_type,
                            balance_shortfall_amount: agg.completionDiscount || null,
                            balance_shortfall_currency: agg.saleCurrency || sale?.sale_currency,
                            sale_currency: agg.saleCurrency || sale?.sale_currency || 'USD',
                          },
                          t,
                        )}
                      </td>
                      <td>
                        {agg.uzsPay > 0 ? (
                          <span style={{ color: agg.activeStatuses.every((s) => s === 'completed') ? '#4caf50' : 'inherit' }}>
                            {agg.uzsPay.toLocaleString()} UZS
                          </span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>
                        {agg.usdPay > 0 ? (
                          <span style={{ color: agg.activeStatuses.every((s) => s === 'completed') ? '#4caf50' : 'inherit' }}>
                            ${agg.usdPay.toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>{sale?.customer_detail?.name || '-'}</td>
                      <td>{sale?.customer_detail?.telephone || <span style={{ color: '#bbb' }}>—</span>}</td>
                      <td>{sale?.salesman_detail?.username || '-'}</td>
                      <td>{renderDispatcherCell(sale)}</td>
                    </tr>
                    {expanded &&
                      row.sales.map((item) => (
                        <tr key={`${row.key}-item-${item.id}`} className="sale-group-detail-row">
                          <td colSpan="3" aria-hidden />
                          {renderSaleProductCells(item, { detail: true })}
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={SALES_FOOTER_LABEL_COL_SPAN} style={{ textAlign: 'right' }}>
                {t('table.totalFooter', { ns: 'sales' })}
              </td>
              <td style={{ fontWeight: 600 }}>{salesColumnTotals.quantity.toLocaleString()}</td>
              <td>—</td>
              <td style={{ fontWeight: 600 }}>
                {!filteredSales.length
                  ? '—'
                  : salesColumnTotals.totalAmountCurrency
                    ? formatDisplayAmount(
                        salesColumnTotals.totalAmount,
                        salesColumnTotals.totalAmountCurrency,
                      )
                    : formatPlainAmount(salesColumnTotals.totalAmount)}
              </td>
              <td style={{ fontWeight: 600 }}>
                {!filteredSales.length
                  ? '—'
                  : salesColumnTotals.totalDiscount > 0
                    ? salesColumnTotals.totalDiscountCurrency
                      ? formatDisplayAmount(
                          salesColumnTotals.totalDiscount,
                          salesColumnTotals.totalDiscountCurrency,
                        )
                      : formatPlainAmount(salesColumnTotals.totalDiscount)
                    : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {salesColumnTotals.uzs > 0 ? `${salesColumnTotals.uzs.toLocaleString()} UZS` : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {salesColumnTotals.usd > 0 ? `$${salesColumnTotals.usd.toFixed(2)}` : '—'}
              </td>
              <td colSpan={SALES_TABLE_COLUMN_COUNT - SALES_FOOTER_LABEL_COL_SPAN - 6}>—</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Sales;

