import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { getCachedProducts, invalidateProductsCache } from '../utils/catalogCache';
import { productCostPickerLabel } from '../utils/productCost';
import { plannedSellingSummary } from '../utils/orderPlannedPricing';
import SortableTh from '../components/SortableTh';
import ProductCatalogFilterFields from '../components/ProductCatalogFilterFields';
import { matchesProductCatalogFilters, getCascadedFilterOptions, getCascadedDateOptions } from '../utils/productFilterUtils';
import { useClientTableSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import FormSearchableSelect from '../components/FormSearchableSelect';
import FilterSearchableSelect from '../components/FilterSearchableSelect';
import { formatAppDateTime } from '../utils/localeFormat';
import './TablePage.css';
import {
  categoryTypeLabel,
  productCategoryTypeOptions,
  useProductCategoryTypes,
} from '../utils/productCategoryTypes';
import AmountInput from '../components/AmountInput';
import FilterPanel from '../components/FilterPanel';
import useCbuExchangeRate from '../hooks/useCbuExchangeRate';

const EMPTY_FORM = {
  product: '',
  quantity: '',
  location: '',
  selling_price: '',
  selling_price_currency: 'USD',
  unit_supplier_cost_usd: '',
  unit_supplier_cost_uzs: '',
};

/** "fixed at 12 000" — only for so'm bought by hand, whose value no longer moves with the rate. */
function frozenRateNote(layer, t) {
  const uzs = parseFloat(layer.manual_cost_uzs) || 0;
  const rate = parseFloat(layer.manual_cost_rate) || 0;
  if (!(uzs > 0) || !(rate > 0)) return null;
  return t('table.frozenAt', {
    rate: rate.toLocaleString(undefined, { maximumFractionDigits: 0 }),
  });
}

/** Price with its own currency symbol — a product may now be quoted in either. */
function formatSellingPrice(amount, currency) {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'UZS'
    ? `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} so'm`
    : `$${n.toFixed(2)}`;
}

/** All active inventory filters except Layer No (used both to filter the table and to build the Layer No dropdown's own options). */
function matchesInventoryFiltersExceptLayer(item, filters) {
  if (filters.category_type && item.product_detail?.category_type !== filters.category_type) return false;
  if (!matchesProductCatalogFilters(item.product_detail, filters)) return false;
  if (filters.status && item.status !== filters.status) return false;
  const d = item.created_at || item.updated_at;
  if (filters.year) {
    const y = new Date(d).getFullYear().toString();
    if (y !== filters.year) return false;
  }
  if (filters.month) {
    const m = (new Date(d).getMonth() + 1).toString();
    if (m !== filters.month) return false;
  }
  return true;
}

/**
 * What was paid for one unit of this layer, split by the currency it was paid in.
 *
 * For stock from a supplier order that is simply the two cost legs. For stock bought by hand
 * the legs were merged on the way in — the so'm was converted once, at that day's rate, and
 * stored as dollars so nothing revalues it later — so the columns read what was *typed* in each
 * box instead. The books still carry the combined dollar figure; these two columns say where it
 * came from, which is the same job they already do for order stock.
 *
 * The two columns are never added together, here or anywhere: each is a total of money paid in
 * its own currency, so there is nothing to double count.
 */
function layerCostUzsNum(layer) {
  if (layer.manual_cost_rate != null) return parseFloat(layer.manual_cost_uzs) || 0;
  return (parseFloat(layer.unit_supplier_cost_uzs) || 0) + (parseFloat(layer.unit_cargo_cost_uzs) || 0);
}

function layerCostUsdNum(layer) {
  if (layer.manual_cost_rate != null) return parseFloat(layer.manual_cost_usd) || 0;
  return (parseFloat(layer.unit_supplier_cost_usd) || 0) + (parseFloat(layer.unit_cargo_cost_usd) || 0);
}

function layerLandedCostCells(layer) {
  const uzs = layerCostUzsNum(layer);
  const usd = layerCostUsdNum(layer);
  return {
    uzsTotal: uzs > 0 ? uzs.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—',
    usdTotal: usd > 0 ? `$${usd.toFixed(2)}` : '—',
  };
}

function inventorySellingCell(productDetail, stockingOrder) {
  const label = plannedSellingSummary(stockingOrder || null);
  if (label) return label;
  const price = formatSellingPrice(
    productDetail?.selling_price,
    productDetail?.selling_price_currency,
  );
  return price ? `${price}/u` : '—';
}

function invSellingPriceNum(item) {
  const so = item.stocking_order;
  if (so?.selling_price != null && String(so.selling_price).trim() !== '') {
    const n = parseFloat(so.selling_price);
    return Number.isFinite(n) ? n : 0;
  }
  const pu = parseFloat(item.product_detail?.selling_price);
  return Number.isFinite(pu) ? pu : 0;
}

const INVENTORY_SORT_ACCESSORS = {
  category_type: (it) => String(it.product_detail?.category_type ?? '').toLowerCase(),
  category: (it) => String(it.product_detail?.category ?? '').toLowerCase(),
  rec_no: (it) => Number(it.product_detail?.id ?? it.product) || 0,
  product: (it) =>
    it.product_detail
      ? `${it.product_detail.brand} ${it.product_detail.model}`.toLowerCase()
      : String(it.product ?? ''),
  brand: (it) => String(it.product_detail?.brand ?? '').toLowerCase(),
  model: (it) => String(it.product_detail?.model ?? '').toLowerCase(),
  size: (it) => String(it.product_detail?.size ?? '').toLowerCase(),
  color: (it) => String(it.product_detail?.color ?? '').toLowerCase(),
  layer: (it) => Number(it.batch_id) || 0,
  cost_uzs: (it) => layerCostUzsNum(it),
  cost_usd: (it) => layerCostUsdNum(it),
  selling: (it) => invSellingPriceNum(it),
  quantity: (it) => Number(it.quantity) || 0,
  status: (it) => String(it.status ?? '').toLowerCase(),
  location: (it) => String(it.location ?? '').toLowerCase(),
  updated_at: (it) => new Date(it.updated_at).getTime() || 0,
};

const Inventory = () => {
  const { t, tStatus, monthOptions } = useAppTranslation(['inventory', 'common', 'status']);
  const { hasPermission } = usePermissions();
  const canAddInventory = hasPermission('inventory.create');
  const [inventory, setInventory] = useState([]);
  const knownCategoryTypes = useProductCategoryTypes();
  const productCategoryTypes = useMemo(
    () => productCategoryTypeOptions(inventory, t, undefined, knownCategoryTypes),
    [inventory, t, knownCategoryTypes],
  );
  const [filteredInventory, setFilteredInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formCategoryType, setFormCategoryType] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [filters, setFilters] = useState({
    category_type: '',
    category: [],
    brand: [],
    model: [],
    sizes: [],
    color: [],
    status: '',
    year: '',
    month: '',
    layer: '',
  });
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [originOptions, setOriginOptions] = useState([]);
  // Only while the form is open: the rate is what a soum cost gets frozen against, so it is
  // fetched when someone is about to type one, not on every visit to the page.
  const { cbuRate } = useCbuExchangeRate(showForm);

  useEffect(() => {
    fetchInventory();
    fetchProducts();
    fetchOriginOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * "Qayerdan" options, from the endpoint that unions orders and products.
   *
   * Not derived from the rows on this page: a country used only on an order would be missing,
   * and the whole point is that the two pages offer the same list.
   */
  const fetchOriginOptions = async () => {
    try {
      const res = await api.get('/products/supplier_countries/');
      setOriginOptions(res.data?.supplier_countries || []);
    } catch (error) {
      console.error('Error fetching supplier countries:', error);
    }
  };

  const fetchInventory = async () => {
    try {
      const response = await apiGetAll('/inventory/layers/');
      const inventoryList = response.data.results || response.data;
      setInventory(inventoryList);
      applyFilters(inventoryList);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };



  const applyFilters = (inventoryList) => {
    let filtered = inventoryList.filter((item) => matchesInventoryFiltersExceptLayer(item, filters));
    if (filters.layer) {
      filtered = filtered.filter((item) => String(item.batch_id) === String(filters.layer));
    }
    setFilteredInventory(filtered);
  };

  useEffect(() => {
    if (inventory.length > 0) {
      applyFilters(inventory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const layerFilterOptions = useMemo(
    () =>
      [...new Set(
        inventory
          .filter((item) => matchesInventoryFiltersExceptLayer(item, filters))
          .map((item) => item.batch_id),
      )]
        .filter((id) => id != null)
        .sort((a, b) => a - b),
    [inventory, filters],
  );

  const inventoryColumnTotals = useMemo(() => {
    let quantity = 0;
    let uzsTotal = 0;
    let usdTotal = 0;
    for (const item of filteredInventory) {
      const q = parseInt(item.quantity, 10) || 0;
      quantity += q;
      uzsTotal += layerCostUzsNum(item) * q;
      usdTotal += layerCostUsdNum(item) * q;
    }
    return { quantity, uzsTotal, usdTotal };
  }, [filteredInventory]);

  /**
   * Hints under the money fields, written as the sum they actually are: `3 × $50.00 = $150.00`.
   *
   * They used to read "= $150.00 qator jami" under both the price and the cost, in identical
   * words, which left no way to tell which field a figure belonged to or where it came from —
   * a $50 cost on three units looked like it might be the price and the cost added together.
   * Showing the multiplication answers that without anyone having to ask.
   */
  const money = useCallback(
    (amount, currency) =>
      currency === 'UZS'
        ? `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${t('form.soum')}`
        : `$${amount.toFixed(2)}`,
    [t],
  );

  const sellingLineTotal = useMemo(() => {
    const unit = parseFloat(formData.selling_price) || 0;
    const qty = parseInt(formData.quantity, 10) || 0;
    if (!(unit > 0) || !(qty > 0)) return null;
    const cur = formData.selling_price_currency;
    return t('form.sellingLine', {
      qty,
      unit: money(unit, cur),
      total: money(unit * qty, cur),
    });
  }, [formData.selling_price, formData.selling_price_currency, formData.quantity, money, t]);

  /**
   * What the buy will cost, per currency, and what the soum half is about to be fixed at.
   *
   * The frozen figure is shown before the buy rather than after, because it is the number the
   * books will carry from then on and it is the last moment anyone can disagree with it.
   */
  const costTotals = useMemo(() => {
    const usd = parseFloat(formData.unit_supplier_cost_usd) || 0;
    const uzs = parseFloat(formData.unit_supplier_cost_uzs) || 0;
    const qty = parseInt(formData.quantity, 10) || 0;
    const lines = [];
    for (const [unit, cur] of [[usd, 'USD'], [uzs, 'UZS']]) {
      if (unit > 0 && qty > 0) {
        lines.push(
          t('form.costLine', {
            qty,
            unit: money(unit, cur),
            total: money(unit * qty, cur),
          }),
        );
      }
    }
    const rate = parseFloat(cbuRate) || 0;
    return {
      lines,
      frozenUsd: uzs > 0 && rate > 0 ? (usd + uzs / rate).toFixed(2) : null,
    };
  }, [
    formData.unit_supplier_cost_usd,
    formData.unit_supplier_cost_uzs,
    formData.quantity,
    cbuRate,
    money,
    t,
  ]);

  const invSort = useClientTableSort(INVENTORY_SORT_ACCESSORS);
  const displayInventory = useMemo(
    () => invSort.sortRows(filteredInventory),
    [filteredInventory, invSort]
  );

  const fetchProducts = async () => {
    try {
      const list = await getCachedProducts(api);
      setProducts(list);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    const qty = parseInt(formData.quantity, 10) || 0;
    const usd = parseFloat(formData.unit_supplier_cost_usd) || 0;
    const uzs = parseFloat(formData.unit_supplier_cost_uzs) || 0;
    const selling = parseFloat(formData.selling_price) || 0;
    if (qty < 1) {
      alert(t('notifications.errQuantity'));
      return;
    }
    if (!(selling > 0)) {
      alert(t('notifications.errSellingPrice'));
      return;
    }
    // Either box, or both. A layer with no cost is free stock, and every sale off it would read
    // as pure profit.
    if (!(usd > 0) && !(uzs > 0)) {
      alert(t('notifications.errSupplierCost'));
      return;
    }
    try {
      const payload = {
        product: formData.product,
        quantity: qty,
        // Status is not asked for: this page puts goods on the shelf, and the server records
        // them as Omborda whatever is sent.
        location: formData.location,
        selling_usd_per_unit: selling,
        selling_price_currency: formData.selling_price_currency,
        unit_supplier_cost_usd: usd,
        unit_supplier_cost_uzs: uzs,
      };
      await api.post('/inventory/', payload);
      setShowForm(false);
      setFormCategoryType('');
      setFormCategory('');
      setFormData(EMPTY_FORM);
      fetchInventory();
      // The buy rewrites the product's selling price, its currency and its country, so the
      // cached catalogue is now stale — the next picker would offer the old figures.
      invalidateProductsCache();
      fetchProducts();
      fetchOriginOptions();
    } catch (error) {
      console.error('Error saving inventory item:', error);
      const data = error.response?.data;
      const msg =
        (typeof data === 'string' && data) ||
        data?.detail ||
        (Array.isArray(data) ? data.join('\n') : null) ||
        (data && typeof data === 'object'
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .join('\n')
          : null) ||
        t('notifications.errSave');
      alert(msg);
    }
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="inventory" />
        {canAddInventory && (
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? t('actions.cancel', { ns: 'common' }) : `+ ${t('addItem')}`}
          </button>
        )}
      </div>

      {showForm && canAddInventory && (
        <div className="form-card">
          <h2>{t('newItem')}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>
                  {t('form.categoryType')}{' '}
                  <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>
                    {t('filters.filterProductsHint')}
                  </span>
                </label>
                <FormSearchableSelect
                  value={formCategoryType}
                  onChange={(v) => {
                    setFormCategoryType(v);
                    setFormCategory('');
                    setFormData({ ...formData, product: '' });
                  }}
                  options={productCategoryTypes}
                  emptyLabel={t('filters.allTypes')}
                  placeholder={t('filters.allTypes')}
                  aria-label={t('form.categoryType')}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('form.category')}{' '}
                  <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>
                    {t('filters.filterProductsHint')}
                  </span>
                </label>
                <FormSearchableSelect
                  value={formCategory}
                  onChange={(v) => { setFormCategory(v); setFormData({ ...formData, product: '' }); }}
                  options={[...new Set(
                    products
                      .filter((p) => !formCategoryType || p.category_type === formCategoryType)
                      .map((p) => p.category)
                      .filter(Boolean),
                  )].sort()}
                  emptyLabel={t('filters.allCategories')}
                  placeholder={t('filters.allCategories')}
                  aria-label={t('form.category')}
                />
              </div>
              <div className="form-group">
                <label>{t('form.product')}</label>
                <FormSearchableSelect
                  value={formData.product}
                  onChange={(pid) => {
                    const p = products.find((x) => String(x.id) === pid);
                    const sp = p?.selling_price != null ? parseFloat(p.selling_price) : NaN;
                    const hasPrice = Number.isFinite(sp) && sp > 0;
                    setFormData({
                      ...formData,
                      product: pid,
                      // The price carries its currency with it, or a soum price would land in
                      // the box still labelled dollars.
                      selling_price: hasPrice ? String(sp) : formData.selling_price,
                      selling_price_currency: hasPrice
                        ? (p?.selling_price_currency || 'USD')
                        : formData.selling_price_currency,
                      location: p?.supplier_country || formData.location,
                    });
                  }}
                  options={products
                    .filter(
                      (p) =>
                        (!formCategoryType || p.category_type === formCategoryType) &&
                        (!formCategory || p.category === formCategory),
                    )
                    .slice()
                    .sort((a, b) => b.id - a.id)
                    .map((product) => ({
                      value: String(product.id),
                      label: productCostPickerLabel(product),
                    }))}
                  emptyLabel={t('form.selectProduct')}
                  placeholder={t('form.selectProduct')}
                  aria-label={t('form.product')}
                />
              </div>
              <div className="form-group">
                <label>{t('quantity')}</label>
                <input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>
                  {t('form.sellingPrice')}{' '}
                  <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <AmountInput
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder={
                      formData.selling_price_currency === 'UZS'
                        ? t('form.uzsPerUnit')
                        : t('form.usdPerUnit')
                    }
                    value={formData.selling_price}
                    onChange={(e) => setFormData({ ...formData, selling_price: e.target.value })}
                    required
                  />
                  {/* One currency, not a pair: a price is quoted in one or the other. */}
                  <select
                    style={{ width: '90px', flex: '0 0 auto' }}
                    value={formData.selling_price_currency}
                    onChange={(e) =>
                      setFormData({ ...formData, selling_price_currency: e.target.value })
                    }
                    aria-label={t('form.sellingCurrency')}
                  >
                    <option value="USD">USD</option>
                    <option value="UZS">UZS</option>
                  </select>
                </div>
                {sellingLineTotal && (
                  <span className="orders-field-hint">{sellingLineTotal}</span>
                )}
              </div>
              <div className="form-group">
                <label>
                  {t('form.costPerUnit')} <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <AmountInput
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder={t('form.usdPerUnit')}
                    aria-label={t('form.costUsdLabel')}
                    value={formData.unit_supplier_cost_usd}
                    onChange={(e) =>
                      setFormData({ ...formData, unit_supplier_cost_usd: e.target.value })
                    }
                  />
                  <AmountInput
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder={t('form.uzsPerUnit')}
                    aria-label={t('form.costUzsLabel')}
                    value={formData.unit_supplier_cost_uzs}
                    onChange={(e) =>
                      setFormData({ ...formData, unit_supplier_cost_uzs: e.target.value })
                    }
                  />
                </div>
                {costTotals.lines.map((line) => (
                  <span key={line} className="orders-field-hint" style={{ display: 'block' }}>
                    {line}
                  </span>
                ))}
                {costTotals.frozenUsd != null && (
                  <span
                    className="orders-field-hint"
                    style={{ display: 'block', color: '#2c5282' }}
                  >
                    {t('form.frozenRate', { amount: costTotals.frozenUsd })}
                  </span>
                )}
              </div>
              <div className="form-group">
                <label>
                  {t('form.origin')}{' '}
                  <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>
                    {t('form.originHint')}
                  </span>
                </label>
                <FormSearchableSelect
                  value={formData.location}
                  onChange={(v) => setFormData({ ...formData, location: v })}
                  options={originOptions.map((country) => ({
                    value: country,
                    label: country.charAt(0).toUpperCase() + country.slice(1),
                  }))}
                  emptyLabel={t('form.selectOrigin')}
                  placeholder={t('form.enterOrigin')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addOrigin') + ': "{{query}}"'}
                  aria-label={t('form.origin')}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('form.create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      {!showForm && (
        <FilterPanel title={t('filters.title', { ns: 'common' })} filters={filters} style={{ marginBottom: '16px' }}>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('form.categoryType')}</label>
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
            options={getCascadedFilterOptions(inventory, filters, (i) => i.product_detail, null, (item, _excl) => {
              const d = item.created_at || item.updated_at;
              if (filters.year) {
                const y = new Date(d).getFullYear().toString();
                if (y !== filters.year) return false;
              }
              if (filters.month) {
                const m = (new Date(d).getMonth() + 1).toString();
                if (m !== filters.month) return false;
              }
              if (filters.layer && String(item.batch_id) !== String(filters.layer)) return false;
              return true;
            })}
            t={t}
            fieldLabels={{
              category: t('form.category'),
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
            <label>{t('form.status')}</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{t('filters.allStatuses')}</option>
              {['in_inventory', 'reserved', 'sold', 'returned'].map((st) => (
                <option key={st} value={st}>
                  {tStatus(st, 'inventory')}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('table.layerNo')}</label>
            <FilterSearchableSelect
              value={filters.layer}
              onChange={(val) => setFilters({ ...filters, layer: val })}
              options={layerFilterOptions.map((id) => ({ value: String(id), label: `#${id}` }))}
              emptyLabel={t('filters.allLayers')}
              aria-label={t('table.layerNo')}
            />
          </div>
          {(() => {
            const invDateAccessor = (item) => item.created_at || item.updated_at;
            const dateOpts = getCascadedDateOptions(
              inventory,
              filters,
              invDateAccessor,
              (i) => i.product_detail,
              (item) => !filters.layer || String(item.batch_id) === String(filters.layer),
            );
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
                  year: '',
                  month: '',
                  layer: '',
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
        <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortableTh columnId="category_type" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.categoryType')}
              </SortableTh>
              <SortableTh columnId="category" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.category')}
              </SortableTh>
              <SortableTh columnId="rec_no" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.recNo')}
              </SortableTh>
              <SortableTh columnId="brand" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.brand')}
              </SortableTh>
              <SortableTh columnId="model" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.model')}
              </SortableTh>
              <SortableTh columnId="size" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.size')}
              </SortableTh>
              <SortableTh columnId="color" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.color')}
              </SortableTh>
              <SortableTh columnId="layer" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.layerNo')}
              </SortableTh>
              <SortableTh columnId="cost_uzs" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.landedCostUzs')}
              </SortableTh>
              <SortableTh columnId="cost_usd" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.landedCostUsd')}
              </SortableTh>
              <SortableTh columnId="selling" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.sellingPerUnit')}
              </SortableTh>
              <SortableTh columnId="quantity" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('quantity')}
              </SortableTh>
              <SortableTh columnId="status" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('form.status')}
              </SortableTh>
              <SortableTh columnId="location" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.location')}
              </SortableTh>
              <SortableTh columnId="updated_at" sortCol={invSort.sortCol} sortDir={invSort.sortDir} onSort={invSort.onHeaderClick}>
                {t('table.updated')}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {filteredInventory.length === 0 ? (
              <tr>
                <td colSpan="15" style={{ textAlign: 'center' }}>
                  {t('noStock')}
                </td>
              </tr>
            ) : (
              displayInventory.map((item) => {
                const cost = layerLandedCostCells(item);
                const sell = inventorySellingCell(item.product_detail, item.stocking_order);
                const sellTip = plannedSellingSummary(item.stocking_order) || '';
                return (
                <tr key={item.batch_id}>
                  <td>
                    {categoryTypeLabel(item.product_detail?.category_type, t) || (
                      <span style={{ color: '#999' }}>—</span>
                    )}
                  </td>
                  <td>{item.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
                  <td><strong>#{item.product_detail?.id ?? item.product}</strong></td>
                  <td>{item.product_detail?.brand || '-'}</td>
                  <td>{item.product_detail?.model || '-'}</td>
                  <td><strong>{item.product_detail?.size || '-'}</strong></td>
                  <td><strong>{item.product_detail?.color || '-'}</strong></td>
                  <td style={{ fontSize: '0.85em', color: '#666' }}>#{item.batch_id}</td>
                  <td style={{ fontSize: '0.9em' }}>
                    {cost.uzsTotal}
                    {/*
                      Hand-added so'm was converted once and never floats again, unlike the
                      so'm leg on order stock, which is revalued at every report's rate. Same
                      column, different behaviour — so the rate it was fixed at is named here
                      rather than left for someone to wonder about.
                    */}
                    {frozenRateNote(item, t) && (
                      <div style={{ fontSize: '0.85em', color: '#718096' }}>
                        {frozenRateNote(item, t)}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: '0.9em' }}>{cost.usdTotal}</td>
                  <td style={{ fontSize: '0.9em', color: '#2c3e50' }} title={sellTip || undefined}>
                    {sell}
                  </td>
                  <td>{item.quantity}</td>
                  <td>
                    <span className={`status-badge ${item.status}`}>
                      {tStatus(item.status, 'inventory')}
                    </span>
                  </td>
                  <td>{item.location || '-'}</td>
                  <td>{formatAppDateTime(item.updated_at)}</td>
                </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="8" style={{ textAlign: 'right' }}>
                {t('table.total')}
              </td>
              <td style={{ fontWeight: 600, fontSize: '0.9em' }}>
                {inventoryColumnTotals.uzsTotal > 0
                  ? inventoryColumnTotals.uzsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : '—'}
              </td>
              <td style={{ fontWeight: 600, fontSize: '0.9em' }}>
                {inventoryColumnTotals.usdTotal > 0
                  ? `$${inventoryColumnTotals.usdTotal.toFixed(2)}`
                  : '—'}
              </td>
              <td style={{ fontWeight: 600, fontSize: '0.9em', color: '#999' }}>—</td>
              <td style={{ fontWeight: 600 }}>{inventoryColumnTotals.quantity.toLocaleString()}</td>
              <td colSpan="3">—</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Inventory;

