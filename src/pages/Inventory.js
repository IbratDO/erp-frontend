import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../utils/api';
import Modal, { WIDE } from '../components/Modal';
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
import BusyForm, { SubmitButton } from '../components/BusyForm';
import TableDownloadButton from '../components/TableDownloadButton';
import { inventorySellingCell, invSellingPriceNum } from '../utils/inventorySelling';
import { layerToLabelData } from '../utils/layerLabel';
import { buildBatchLabelSheetHtml, buildLabelSheetHtml, totalLabelCount } from '../components/labelPrint';
import printHtmlDocument from '../utils/printHtml';
import StockCountModal from '../components/StockCountModal';
import LayerPriceModal from '../components/LayerPriceModal';

const EMPTY_FORM = {
  product: '',
  quantity: '',
  location: '',
  selling_price: '',
  selling_price_currency: 'USD',
  unit_supplier_cost_usd: '',
  unit_supplier_cost_uzs: '',
  // The two pickers that only narrow the product list. Per line rather than shared, because a
  // basket is usually a mix — one pair of shoes and three shirts — and a single shared filter
  // would have to be cleared and re-set between every line.
  category_type: '',
  category: '',
};

let nextLineKey = 1;
const newFormLine = (seed = {}) => ({ ...EMPTY_FORM, ...seed, key: nextLineKey++ });

/** "fixed at 12 000" — only for so'm bought by hand, whose value no longer moves with the rate. */
function frozenRateNote(layer, t) {
  const uzs = parseFloat(layer.manual_cost_uzs) || 0;
  const rate = parseFloat(layer.manual_cost_rate) || 0;
  if (!(uzs > 0) || !(rate > 0)) return null;
  return t('table.frozenAt', {
    rate: rate.toLocaleString(undefined, { maximumFractionDigits: 0 }),
  });
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

// inventorySellingCell / invSellingPriceNum / formatSellingPrice now live in
// ../utils/inventorySelling, so the printed label quotes the same price this table shows.

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
  // The rendered table, so the download button can read exactly what is on the screen —
  // current filters, current sort, current columns. See utils/tableCsv.
  const tableRef = useRef(null);
  const { t, tStatus, monthOptions } = useAppTranslation(['inventory', 'common', 'status']);
  const { hasPermission } = usePermissions();
  const canAddInventory = hasPermission('inventory.create');
  // Granted to the Founder role alone: cancelling a line puts cash back into the till.
  const canCancelLayer = hasPermission('inventory.cancel_layer');
  // Printing a label only reproduces what is already on the screen beside the button, so it
  // rides on the permission that got the user to this page rather than minting a new code
  // (which would need a seed_rbac run on deploy to restrict something unrestrictable).
  const canPrintLabels = hasPermission('inventory.view');
  // Counting the shelves. Correcting the books afterwards is a separate permission the modal
  // checks for itself — the CEO counts, the Founder decides.
  const canCount = hasPermission('inventory.count');
  // Re-pricing a shelf line: Founder, Admin, CEO and Senior Sales Manager. It moves no
  // money — stock is carried at cost and a sale snapshots its own price when it is made.
  const canEditPrice = hasPermission('inventory.edit_price');
  const [priceLayer, setPriceLayer] = useState(null);
  const [showStockCount, setShowStockCount] = useState(false);
  // Labels have their own leading column now, so Amallar is back to being about cancelling.
  const showActions = canCancelLayer || canEditPrice;

  /**
   * Straight to the printer's own dialog — no step in between.
   *
   * There used to be a preview window with a copies box. It was one more click on a job the
   * operator does dozens of times in a row, and the browser's print dialog is already a preview
   * and already a confirmation: nothing reaches the roll until it is accepted.
   *
   * One sticker per unit on the shelf, because that is what is being labelled. To print a
   * different number, change the copies count in the print dialog itself.
   */
  const handlePrintLabels = useCallback((item) => {
    const label = layerToLabelData(item);
    if (!label) return;
    printHtmlDocument(buildLabelSheetHtml(label, label.maxCopies || 1));
  }, []);

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
  const [formLines, setFormLines] = useState(() => [newFormLine()]);
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

  const sellingLineTotalFor = useCallback((line) => {
    const unit = parseFloat(line.selling_price) || 0;
    const qty = parseInt(line.quantity, 10) || 0;
    if (!(unit > 0) || !(qty > 0)) return null;
    const cur = line.selling_price_currency;
    return t('form.sellingLine', {
      qty,
      unit: money(unit, cur),
      total: money(unit * qty, cur),
    });
  }, [money, t]);

  /**
   * What one line will cost, per currency, and what its soum half is about to be fixed at.
   *
   * The frozen figure is shown before the buy rather than after, because it is the number the
   * books will carry from then on and it is the last moment anyone can disagree with it.
   */
  const costTotalsFor = useCallback((line) => {
    const usd = parseFloat(line.unit_supplier_cost_usd) || 0;
    const uzs = parseFloat(line.unit_supplier_cost_uzs) || 0;
    const qty = parseInt(line.quantity, 10) || 0;
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
  }, [cbuRate, money, t]);

  /**
   * What the whole basket is about to take out of the till.
   *
   * Worth its own line even though each row already shows its own cost: the money leaves in one
   * go and the till has to cover the total, not the largest line. Someone adding a sixth row is
   * otherwise adding up five numbers in their head to know whether it will go through.
   */
  const basketCost = useMemo(() => {
    let usd = 0;
    let uzs = 0;
    for (const line of formLines) {
      const qty = parseInt(line.quantity, 10) || 0;
      if (qty <= 0) continue;
      usd += (parseFloat(line.unit_supplier_cost_usd) || 0) * qty;
      uzs += (parseFloat(line.unit_supplier_cost_uzs) || 0) * qty;
    }
    return { usd, uzs };
  }, [formLines]);

  const updateLine = useCallback((key, patch) => {
    setFormLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }, []);

  // Newest layer first. The API returns batches grouped by product and oldest-first, which is
  // the order FIFO consumes them in and the wrong one to read: what someone opening this page
  // wants to see is the stock that just arrived, not the stock that has been sitting longest.
  // `updated_at` is the batch's `received_at` — see InventoryLayerSerializer.
  const invSort = useClientTableSort(INVENTORY_SORT_ACCESSORS, { col: 'updated_at', dir: 'desc' });
  const displayInventory = useMemo(
    () => invSort.sortRows(filteredInventory),
    [filteredInventory, invSort]
  );

  // -- Batch label printing ---------------------------------------------------------------
  // Off until asked for: the checkbox column costs every reader width on an already-wide table,
  // and most printing is one layer at a time straight off the row's own button.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedLayerIds, setSelectedLayerIds] = useState(() => new Set());

  const toggleLayerSelected = useCallback((batchId) => {
    setSelectedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }, []);

  /**
   * The rows that are both ticked and still on screen, in the order the table is showing them.
   *
   * Scoped to `displayInventory` on purpose. A row filtered out of view is out of mind — printing
   * a sticker for something the operator can no longer see would be the kind of surprise that
   * wastes a roll. The tick is remembered, though, so narrowing a filter and widening it again
   * does not lose the selection.
   */
  const selectedLabelEntries = useMemo(() => {
    if (!selectMode) return [];
    return displayInventory
      .filter((item) => selectedLayerIds.has(item.batch_id))
      .map((item) => ({ item, label: layerToLabelData(item) }))
      .filter((entry) => entry.label)
      .map((entry) => ({ label: entry.label, copies: entry.label.maxCopies || 1 }));
  }, [selectMode, displayInventory, selectedLayerIds]);

  const selectedLabelTotal = useMemo(
    () => totalLabelCount(selectedLabelEntries),
    [selectedLabelEntries],
  );

  /**
   * The header tick box: on when every row currently on screen is selected.
   *
   * Scoped to what is visible, like the selection itself — after filtering to one brand, "select
   * all" means that brand, not the whole warehouse.
   */
  const allShownSelected = useMemo(
    () => displayInventory.length > 0
      && displayInventory.every((item) => selectedLayerIds.has(item.batch_id)),
    [displayInventory, selectedLayerIds],
  );

  const toggleAllShown = useCallback(() => {
    setSelectedLayerIds((prev) => {
      const next = new Set(prev);
      const shown = displayInventory.map((item) => item.batch_id);
      // Clearing removes only the rows on screen, leaving ticks on rows the filter is hiding —
      // the same rule the selection itself follows.
      if (shown.every((id) => next.has(id))) shown.forEach((id) => next.delete(id));
      else shown.forEach((id) => next.add(id));
      return next;
    });
  }, [displayInventory]);

  /** First click reveals the checkboxes; the next one prints whatever has been ticked. */
  const handleBatchLabelClick = useCallback(() => {
    if (!selectMode) {
      setSelectMode(true);
      return;
    }
    if (!selectedLabelEntries.length) return;
    printHtmlDocument(buildBatchLabelSheetHtml(selectedLabelEntries));
  }, [selectMode, selectedLabelEntries]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedLayerIds(new Set());
  }, []);

  // Columns added to the *left* of Kategoriya turi. Named once because three places have to
  // agree: the header row, the empty-state cell, and the footer's leading label cell — and the
  // footer is the one that goes wrong silently, sliding every total one column sideways.
  const leadingColumns = (selectMode ? 1 : 0) + (canPrintLabels ? 1 : 0);

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
    // A line with nothing chosen is a row somebody added and did not use, not an error. Only
    // what was actually filled in gets bought.
    const filled = formLines.filter((line) => line.product);
    if (!filled.length) {
      alert(t('notifications.errSelectProduct'));
      return;
    }

    const items = [];
    for (let i = 0; i < filled.length; i += 1) {
      const line = filled[i];
      const qty = parseInt(line.quantity, 10) || 0;
      const usd = parseFloat(line.unit_supplier_cost_usd) || 0;
      const uzs = parseFloat(line.unit_supplier_cost_uzs) || 0;
      const selling = parseFloat(line.selling_price) || 0;
      // The row number is named in every message: with several lines on screen, "enter a
      // quantity" on its own leaves the buyer hunting for which one.
      const where = t('form.lineNumber', { number: i + 1 });
      if (qty < 1) {
        alert(`${where}: ${t('notifications.errQuantity')}`);
        return;
      }
      if (!(selling > 0)) {
        alert(`${where}: ${t('notifications.errSellingPrice')}`);
        return;
      }
      // Either box, or both. A layer with no cost is free stock, and every sale off it would
      // read as pure profit.
      if (!(usd > 0) && !(uzs > 0)) {
        alert(`${where}: ${t('notifications.errSupplierCost')}`);
        return;
      }
      items.push({
        product: line.product,
        quantity: qty,
        // Status is not asked for: this page puts goods on the shelf, and the server records
        // them as Omborda whatever is sent.
        location: line.location,
        selling_usd_per_unit: selling,
        selling_price_currency: line.selling_price_currency,
        unit_supplier_cost_usd: usd,
        unit_supplier_cost_uzs: uzs,
      });
    }

    try {
      // One request, whatever the number of lines. Sending them one at a time would let the
      // till run dry partway down the basket and leave half of it bought.
      await api.post('/inventory/batch_create/', { items });
      setShowForm(false);
      setFormLines([newFormLine()]);
      fetchInventory();
      // The buy rewrites the product's selling price, its currency and its country, so the
      // cached catalogue is now stale — the next picker would offer the old figures.
      invalidateProductsCache();
      fetchProducts();
      fetchOriginOptions();
    } catch (error) {
      console.error('Error saving inventory item:', error);
      const data = error.response?.data;
      // The batch endpoint reports per line. Say which row, or a five-line basket comes back
      // with one message and no clue where to look.
      const perLine = Array.isArray(data?.item_errors)
        ? data.item_errors
            .map((row) => {
              const detail =
                row.error ||
                (row.errors
                  ? Object.entries(row.errors)
                      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                      .join(', ')
                  : '');
              return `${t('form.lineNumber', { number: (row.index ?? 0) + 1 })}: ${detail}`;
            })
            .join('\n')
        : null;
      const msg =
        perLine ||
        (typeof data === 'string' && data) ||
        data?.error ||
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

  /**
   * Take a hand-added line back off the shelf and put its money back in the till.
   *
   * The cost is named in the confirmation, because that is the figure that returns to the
   * drawer and it is the only way to check the right row is about to go. Every refusal comes
   * from the server — it is the side that can see whether anything has sold — so this only has
   * to show what it said.
   */
  const handleCancelLayer = async (item) => {
    const cost = layerLandedCostCells(item);
    const ok = window.confirm(
      t('cancelLayer.confirm', {
        product: `${item.product_detail?.brand || ''} ${item.product_detail?.model || ''}`.trim()
          || `#${item.product_detail?.id ?? item.product}`,
        quantity: item.quantity,
        uzs: cost.uzsTotal,
        usd: cost.usdTotal,
      }),
    );
    if (!ok) return;
    try {
      await api.post('/inventory/cancel_layer/', { batch_id: item.batch_id });
      fetchInventory();
      fetchProducts();
    } catch (error) {
      const data = error.response?.data;
      alert(data?.error || data?.detail || t('cancelLayer.err'));
    }
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="inventory" />
        {/* Opens only; each dialog carries its own way out. */}
        <div className="page-header__actions">
          {canCount && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowStockCount(true)}
              title={t('stockCount.hint')}
            >
              {t('stockCount.button')}
            </button>
          )}
          {canAddInventory && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              {`+ ${t('addItem')}`}
            </button>
          )}
        </div>
      </div>

      <Modal
        open={showForm && canAddInventory}
        onClose={() => setShowForm(false)}
        title={t('newItem')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        width={WIDE}
      >
          <BusyForm onSubmit={handleSubmit}>
            {/*
              One row per item, all bought together. The buyer comes back from the market with a
              basket rather than with one thing, and the money for the whole basket leaves the
              till in a single movement — so the form is shaped like the basket and submitted as
              one request. See `batch_create`: a half-bought basket is the outcome worth refusing.
            */}
            <div className="batch-sale-lines-block">
              <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll">
                <table className="batch-sale-lines">
                  <thead>
                    <tr>
                      <th scope="col">{t('form.categoryType')}</th>
                      <th scope="col">{t('form.category')}</th>
                      <th scope="col">
                        {t('form.product')} <span style={{ color: '#e53e3e' }}>*</span>
                      </th>
                      <th scope="col" className="batch-sale-lines__th--num">{t('quantity')}</th>
                      <th scope="col" className="batch-sale-lines__th--num">
                        {t('form.sellingPrice')} <span style={{ color: '#e53e3e' }}>*</span>
                      </th>
                      <th scope="col" className="batch-sale-lines__th--num">
                        {t('form.costPerUnit')} <span style={{ color: '#e53e3e' }}>*</span>
                      </th>
                      <th scope="col">{t('form.origin')}</th>
                      <th
                        className="batch-sale-lines__th--action"
                        aria-label={t('actions.delete', { ns: 'common' })}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line) => {
                      const sellingLineTotal = sellingLineTotalFor(line);
                      const costTotals = costTotalsFor(line);
                      const lineProducts = products.filter(
                        (p) =>
                          (!line.category_type || p.category_type === line.category_type) &&
                          (!line.category || p.category === line.category),
                      );
                      return (
                        <tr key={line.key}>
                          <td>
                            <FormSearchableSelect
                              value={line.category_type}
                              onChange={(v) =>
                                updateLine(line.key, { category_type: v, category: '', product: '' })
                              }
                              options={productCategoryTypes}
                              emptyLabel={t('filters.allTypes')}
                              placeholder={t('filters.allTypes')}
                              aria-label={t('form.categoryType')}
                            />
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.category}
                              onChange={(v) => updateLine(line.key, { category: v, product: '' })}
                              options={[...new Set(
                                products
                                  .filter(
                                    (p) =>
                                      !line.category_type || p.category_type === line.category_type,
                                  )
                                  .map((p) => p.category)
                                  .filter(Boolean),
                              )].sort()}
                              emptyLabel={t('filters.allCategories')}
                              placeholder={t('filters.allCategories')}
                              aria-label={t('form.category')}
                            />
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.product}
                              onChange={(pid) => {
                                const p = products.find((x) => String(x.id) === pid);
                                const sp =
                                  p?.selling_price != null ? parseFloat(p.selling_price) : NaN;
                                const hasPrice = Number.isFinite(sp) && sp > 0;
                                updateLine(line.key, {
                                  product: pid,
                                  // The price carries its currency with it, or a soum price
                                  // would land in the box still labelled dollars.
                                  selling_price: hasPrice ? String(sp) : line.selling_price,
                                  selling_price_currency: hasPrice
                                    ? (p?.selling_price_currency || 'USD')
                                    : line.selling_price_currency,
                                  location: p?.supplier_country || line.location,
                                });
                              }}
                              options={lineProducts
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
                          </td>
                          <td>
                            <input
                              className="batch-sale-lines__control"
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                              aria-label={t('quantity')}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <AmountInput
                                className="batch-sale-lines__control"
                                style={{ flex: 1, minWidth: 0 }}
                                placeholder={
                                  line.selling_price_currency === 'UZS'
                                    ? t('form.uzsPerUnit')
                                    : t('form.usdPerUnit')
                                }
                                value={line.selling_price}
                                onChange={(e) =>
                                  updateLine(line.key, { selling_price: e.target.value })
                                }
                                aria-label={t('form.sellingPrice')}
                              />
                              {/* One currency, not a pair: a price is quoted in one or the other. */}
                              <select
                                style={{ width: '76px', flex: '0 0 auto' }}
                                value={line.selling_price_currency}
                                onChange={(e) =>
                                  updateLine(line.key, { selling_price_currency: e.target.value })
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
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <AmountInput
                                className="batch-sale-lines__control"
                                style={{ flex: 1, minWidth: 0 }}
                                placeholder={t('form.usdPerUnit')}
                                aria-label={t('form.costUsdLabel')}
                                value={line.unit_supplier_cost_usd}
                                onChange={(e) =>
                                  updateLine(line.key, { unit_supplier_cost_usd: e.target.value })
                                }
                              />
                              <AmountInput
                                className="batch-sale-lines__control"
                                style={{ flex: 1, minWidth: 0 }}
                                placeholder={t('form.uzsPerUnit')}
                                aria-label={t('form.costUzsLabel')}
                                value={line.unit_supplier_cost_uzs}
                                onChange={(e) =>
                                  updateLine(line.key, { unit_supplier_cost_uzs: e.target.value })
                                }
                              />
                            </div>
                            {costTotals.lines.map((hint) => (
                              <span
                                key={hint}
                                className="orders-field-hint"
                                style={{ display: 'block' }}
                              >
                                {hint}
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
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.location}
                              onChange={(v) => updateLine(line.key, { location: v })}
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
                          </td>
                          <td className="batch-sale-lines__td--action">
                            {formLines.length > 1 ? (
                              <button
                                type="button"
                                className="batch-sale-lines__remove"
                                onClick={() =>
                                  setFormLines((prev) => prev.filter((l) => l.key !== line.key))
                                }
                                title={t('actions.delete', { ns: 'common' })}
                                aria-label={t('actions.delete', { ns: 'common' })}
                              >
                                &times;
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
            {/*
              The till has to cover the basket, not the biggest line in it. Without this someone
              adding a sixth row is adding five numbers up in their head to know whether it will
              go through.
            */}
            {formLines.length > 1 && (basketCost.usd > 0 || basketCost.uzs > 0) && (
              <p style={{ margin: '4px 0 12px', fontSize: '0.9em', color: '#2c5282' }}>
                {t('form.basketCost', {
                  count: formLines.filter((l) => l.product).length,
                  usd: money(basketCost.usd, 'USD'),
                  uzs: money(basketCost.uzs, 'UZS'),
                })}
              </p>
            )}
            <div className="form-actions batch-sale-lines-actions">
              <button
                type="button"
                className="btn-edit"
                onClick={() => setFormLines((prev) => [...prev, newFormLine()])}
              >
                + {t('form.addLine')}
              </button>
              <SubmitButton className="btn-primary">
                {t('form.create')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={() => setShowForm(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      {/* Filters — the page behind a dialog stays intact. */}
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

      <div className="table-card">
        <div className="table-card__toolbar">
          {canPrintLabels && filteredInventory.length > 0 && (
            <div className="table-card__toolbar-left">
              {selectMode && (
                <button type="button" className="btn-edit" onClick={exitSelectMode}>
                  {t('actions.cancel', { ns: 'common' })}
                </button>
              )}
              <button
                type="button"
                className={`btn-edit${selectMode ? ' btn-edit--active' : ''}`}
                onClick={handleBatchLabelClick}
                disabled={selectMode && selectedLabelEntries.length === 0}
                title={t('labels.batchHint')}
              >
                {selectMode ? t('labels.batchPrint') : t('labels.batchStart')}
              </button>
              {/*
                Rows and stickers are both named, because they are rarely the same number: five
                ticked rows can be forty labels. Seeing the total before the print dialog opens is
                what stops a roll being spent by accident.
              */}
              {selectMode && (
                <span className="batch-label-count">
                  {t('labels.selectedCount', {
                    rows: selectedLabelEntries.length,
                    labels: selectedLabelTotal,
                  })}
                </span>
              )}
            </div>
          )}
          <TableDownloadButton
            tableRef={tableRef}
            filename="ombor-mahsulotlar"
            rowCount={filteredInventory.length}
          />
        </div>
        <div className="data-table-scroll">
        <table className="data-table" ref={tableRef}>
          <thead>
            <tr>
              {selectMode && (
                <th data-noexport className="row-select-cell">
                  <input
                    type="checkbox"
                    aria-label={t('labels.selectAll')}
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                  />
                </th>
              )}
              {canPrintLabels && (
                <th data-noexport className="label-col">{t('labels.column')}</th>
              )}
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
              {showActions && <th>{t('table.actions', { ns: 'common' })}</th>}
            </tr>
          </thead>
          <tbody>
            {filteredInventory.length === 0 ? (
              <tr>
                <td colSpan={(showActions ? 16 : 15) + leadingColumns} style={{ textAlign: 'center' }}>
                  {t('noStock')}
                </td>
              </tr>
            ) : (
              displayInventory.map((item) => {
                const cost = layerLandedCostCells(item);
                const sell = inventorySellingCell(item);
                const sellTip = plannedSellingSummary(item.stocking_order) || '';
                const selected = selectMode && selectedLayerIds.has(item.batch_id);
                return (
                <tr key={item.batch_id} className={selected ? 'row-selected' : undefined}>
                  {selectMode && (
                    <td data-noexport className="row-select-cell">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleLayerSelected(item.batch_id)}
                        aria-label={t('labels.selectRow', { layer: item.batch_id })}
                      />
                    </td>
                  )}
                  {canPrintLabels && (
                    <td data-noexport className="label-col">
                      {/*
                        A layer with no barcode can only mean migration 0132's backfill has not
                        run. Offering a button that would print a sticker with nothing on it is
                        worse than not offering one.
                      */}
                      {item.barcode ? (
                        <button
                          type="button"
                          className="btn-edit"
                          style={{ padding: '5px 12px', fontSize: '0.85em' }}
                          onClick={() => handlePrintLabels(item)}
                        >
                          {t('labels.button')}
                        </button>
                      ) : (
                        <span style={{ color: '#cbd5e0' }}>—</span>
                      )}
                    </td>
                  )}
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
                  {showActions && (
                    <td className="inventory-row-actions">
                      {canEditPrice && (
                        <button
                          type="button"
                          className="btn-edit"
                          style={{ padding: '5px 12px', fontSize: '0.85em' }}
                          onClick={() => setPriceLayer(item)}
                          title={t('layerPrice.hint')}
                        >
                          {t('layerPrice.button')}
                        </button>
                      )}
                      {/*
                        Only hand-added lines. Order stock got its money from a supplier rather
                        than the till, so there is nothing here to give back and the server
                        refuses it — better not to offer the button at all than to offer one
                        that always fails.
                      */}
                      {canCancelLayer && item.manual_cost_rate != null && (
                        <button
                          type="button"
                          className="btn-danger-action"
                          style={{ padding: '5px 12px', fontSize: '0.85em' }}
                          onClick={() => handleCancelLayer(item)}
                        >
                          {t('cancelLayer.button')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8 + leadingColumns} style={{ textAlign: 'right' }}>
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
              <td colSpan={showActions ? 4 : 3}>—</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <LayerPriceModal
        layer={priceLayer}
        open={priceLayer != null}
        onClose={() => setPriceLayer(null)}
        onSaved={fetchInventory}
      />

      {/* Counting no longer changes stock, so there is nothing to refresh on the way out — but a
          count can run for a while and the table behind it will have moved on regardless. */}
      <StockCountModal
        open={showStockCount}
        onClose={() => { setShowStockCount(false); fetchInventory(); }}
      />
    </div>
  );
};

export default Inventory;

