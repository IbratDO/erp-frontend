import { plannedSellingSummary, plannedSellingUsdPerUnit, plannedSellingUzsPerUnit } from './orderPlannedPricing';

/** Per-unit USD cost buckets only (cash + card; no UZS conversion). Mirrors backend Product.cost_per_unit_usd_equivalent. */
export function productCostUsdPortion(p) {
  if (!p) return 0;
  return (parseFloat(p.cost_usd_cash) || 0) + (parseFloat(p.cost_usd_card) || 0);
}

/** Per-unit UZS cost buckets only (cash + card). Mirrors backend Product.cost_per_unit_uzs_total. */
export function productCostUzsPortion(p) {
  if (!p) return 0;
  return (parseFloat(p.cost_uzs_cash) || 0) + (parseFloat(p.cost_uzs_card) || 0);
}

/**
 * Picker / list line: product #id, name, and cost segments without "cash" or "card" labels.
 */
export function productCostPickerLabel(p) {
  if (!p) return '';
  const bits = [];
  const uzsT = productCostUzsPortion(p);
  if (uzsT > 0) bits.push(`UZS ${uzsT.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  const usdT = productCostUsdPortion(p);
  if (usdT > 0) bits.push(`$${usdT.toFixed(2)}`);
  if (bits.length) {
    return `#${p.id} ${p.brand} ${p.model} — ${p.size} (${p.color}) · ${bits.join(' · ')}`;
  }
  return `#${p.id} ${p.brand} ${p.model} — ${p.size} (${p.color})`;
}

/** Combined per-unit costs for table columns (currency totals; legacy *_card folds in). */
export function productCostCells(p) {
  if (!p) return { uzsTotal: '—', usdTotal: '—' };
  const uzsT = productCostUzsPortion(p);
  const usdT = productCostUsdPortion(p);
  return {
    uzsTotal:
      uzsT > 0 ? uzsT.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—',
    usdTotal: usdT > 0 ? `$${usdT.toFixed(2)}` : '—',
  };
}

function formatProductSellingUsd(product) {
  const sp = parseFloat(product?.selling_price);
  if (product?.selling_price != null && product.selling_price !== '' && !Number.isNaN(sp) && sp > 0) {
    return `$${sp.toFixed(2)}`;
  }
  return null;
}

/** Distinct selling price labels for one SKU (inventory layers + product record). */
export function collectProductSellingPriceLabels(product, inventoryRows) {
  if (!product) return [];
  const pid = Number(product.id);
  const labels = new Set();
  const rows = (inventoryRows || []).filter(
    (it) =>
      Number(it.product) === pid &&
      (it.status == null || it.status === 'in_inventory') &&
      Number(it.quantity) > 0
  );
  for (const r of rows) {
    const fromOrder = plannedSellingSummary(r.stocking_order);
    if (fromOrder) {
      labels.add(fromOrder.replace(/\/u$/, ''));
      continue;
    }
    const fromDetail = formatProductSellingUsd(r.product_detail);
    if (fromDetail) labels.add(fromDetail);
  }
  const fromProduct = formatProductSellingUsd(product);
  if (fromProduct) labels.add(fromProduct);
  return [...labels].sort((a, b) => {
    const na = parseFloat(String(a).replace(/[^0-9.]/g, '')) || 0;
    const nb = parseFloat(String(b).replace(/[^0-9.]/g, '')) || 0;
    return na - nb;
  });
}

/** Numeric USD selling price for one inventory layer. */
export function layerSellingUsdNum(layer, product) {
  const fromOrder = plannedSellingUsdPerUnit(layer?.stocking_order);
  if (fromOrder != null && fromOrder > 0) return fromOrder;
  const sp = parseFloat(product?.selling_price);
  if (product?.selling_price != null && product.selling_price !== '' && !Number.isNaN(sp) && sp > 0) {
    return sp;
  }
  return null;
}

/** One sale-picker row per FIFO layer: product info, this layer's price, and available qty. */
export function layerSalePickerLabel(product, layer) {
  if (!product || !layer) return '';
  const core = productCostPickerLabel(product).replace(/\u2014/g, ' - ');
  const summary = plannedSellingSummary(layer.stocking_order);
  const usdNum = layerSellingUsdNum(layer, product);
  const price =
    (summary ? summary.replace(/\/u$/, '') : null) ||
    (usdNum != null ? `$${usdNum.toFixed(2)}` : null) ||
    '—';
  const qty = Number(layer.quantity) || 0;
  const layerNo = layer.batch_id != null ? `Layer #${layer.batch_id}` : 'Layer';
  return `${layerNo} · ${core} · ${price} · ${qty} in stock`;
}

/**
 * Resolve list/final price for a specific inventory layer and sale currency.
 * `rate` (UZS per 1 USD) converts a planned/product price found only in the other
 * currency instead of reusing its raw number as if it were already in `saleCur`.
 */
export function resolveLayerListPrice(layer, product, saleCur, rate) {
  if (!layer) return null;
  const stocking = layer.stocking_order;
  const r = parseFloat(rate);
  const hasRate = Number.isFinite(r) && r > 0;
  if (stocking) {
    if (saleCur === 'UZS') {
      const native = plannedSellingUzsPerUnit(stocking);
      if (native != null && native > 0) return native;
      const usd = plannedSellingUsdPerUnit(stocking);
      if (usd != null && usd > 0) return hasRate ? Math.round(usd * r) : usd;
    } else {
      const native = plannedSellingUsdPerUnit(stocking);
      if (native != null && native > 0) return native;
      const uzs = plannedSellingUzsPerUnit(stocking);
      if (uzs != null && uzs > 0) return hasRate ? Math.round((uzs / r) * 100) / 100 : uzs;
    }
  }
  const sp = parseFloat(product?.selling_price);
  if (product?.selling_price != null && product.selling_price !== '' && !Number.isNaN(sp) && sp > 0) {
    // Product.selling_price is stored in USD; convert when selling in UZS.
    return saleCur === 'UZS' && hasRate ? Math.round(sp * r) : sp;
  }
  return null;
}

/**: #id, brand/model/size/color, cost bits, then selling price (no "List" label — avoids looking like "Line").
 * When inventoryRows is provided, selling prices come from FIFO layers / stocking orders (same as Inventory tab), not only Product.selling_price.
 */
export function productSalePickerLabel(p, inventoryRows = null) {
  if (!p) return '';
  let list;
  if (inventoryRows) {
    const bits = collectProductSellingPriceLabels(p, inventoryRows);
    list = bits.length ? bits.join(' · ') : '—';
  } else {
    list = formatProductSellingUsd(p) || '—';
  }
  const core = productCostPickerLabel(p).replace(/\u2014/g, ' - ');
  return `${core} · ${list}`;
}
