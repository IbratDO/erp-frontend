/** Helpers mirroring Orders tab planned supplier/selling summaries (same rules, no FX). */

export function numOrZero(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return n > 0 && !Number.isNaN(n) ? n : 0;
}

/** Selling summary string for one line ("$X/u" from USD buckets or legacy selling_price). */
export function plannedSellingSummary(order) {
  if (!order) return '';
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const usdTotal = numOrZero(order.selling_usd_cash) + numOrZero(order.selling_usd_card);
  if (usdTotal > 0) return `$${(usdTotal / qi).toFixed(2)}/u`;
  const pu = parseFloat(order.selling_price);
  if (order.selling_price != null && order.selling_price !== '' && !Number.isNaN(pu) && pu > 0) {
    return `$${pu.toFixed(2)}/u`;
  }
  return '';
}

/** Numeric planned USD selling per unit (for forms); null if none. */
export function plannedSellingUsdPerUnit(order) {
  if (!order) return null;
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const usdTotal = numOrZero(order.selling_usd_cash) + numOrZero(order.selling_usd_card);
  if (usdTotal > 0) return usdTotal / qi;
  const pu = parseFloat(order.selling_price);
  if (order.selling_price != null && order.selling_price !== '' && !Number.isNaN(pu) && pu > 0) return pu;
  return null;
}

/** Planned soum selling per unit as a display string; '' when the line has none. */
export function plannedSellingUzsSummary(order) {
  const per = plannedSellingUzsPerUnit(order);
  if (per == null) return '';
  return `${per.toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS/u`;
}

/** Planned soum supplier cost per unit as a display string; '' when the line has none. */
export function plannedSupplierUzsPerUnit(order) {
  if (!order) return '';
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const uzs = numOrZero(order.supplier_cost_uzs_cash) + numOrZero(order.supplier_cost_uzs_card);
  if (uzs <= 0) return '';
  return `${(uzs / qi).toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS/u`;
}

/** Numeric planned UZS selling per unit (for forms); null if none. */
export function plannedSellingUzsPerUnit(order) {
  if (!order) return null;
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const uzsTotal = numOrZero(order.selling_uzs_cash) + numOrZero(order.selling_uzs_card);
  if (uzsTotal > 0) return uzsTotal / qi;
  return null;
}

/** Per-unit supplier buckets for table cells (UZS-only vs USD branches match plannedSupplierPerUnit). */
export function plannedSupplierUnitParts(order) {
  if (!order) return { uzsPerUnit: null, usdPerUnit: null };
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const uzs = numOrZero(order.supplier_cost_uzs_cash) + numOrZero(order.supplier_cost_uzs_card);
  const usdTot = parseFloat(order.cost_total) || 0;
  const usdPu = parseFloat(order.cost_per_unit);
  const usdBuckets = numOrZero(order.supplier_cost_usd_card) + numOrZero(order.supplier_cost_usd_cash);
  // Both legs, independently. Either may be null; a line carrying both is not an error.
  const usdPerUnit =
    usdBuckets > 0
      ? usdBuckets / qi
      : usdTot > 0 && !Number.isNaN(usdPu) && usdPu > 0
        ? usdPu
        : null;
  return {
    uzsPerUnit: uzs > 0 ? uzs / qi : null,
    usdPerUnit,
  };
}

/**
 * Planned supplier cost per unit, in dollars.
 *
 * The soum leg has a column of its own now, so this one answers only for dollars. It used to
 * refuse to answer at all unless the line was in exactly one currency (`usdTot > 0 && uzs <= 0`),
 * which meant an order paid partly in each showed a dash in both price columns — the one case
 * where a person most wants to see the split.
 */
export function plannedSupplierPerUnit(order) {
  if (!order) return '—';
  const qi = Math.max(parseInt(order.ordered_quantity, 10) || 1, 1);
  const usdBuckets = numOrZero(order.supplier_cost_usd_cash) + numOrZero(order.supplier_cost_usd_card);
  if (usdBuckets > 0) return `$${(usdBuckets / qi).toFixed(2)}`;
  const usdTot = parseFloat(order.cost_total) || 0;
  const usdPu = parseFloat(order.cost_per_unit) || 0;
  if (usdTot > 0 && !Number.isNaN(usdPu) && usdPu > 0) return `$${usdPu.toFixed(2)}`;
  return '—';
}

export function plannedSupplierTotal(order) {
  if (!order) return '';
  const usdTot = parseFloat(order.cost_total) || 0;
  if (usdTot > 0) return `$${usdTot.toFixed(2)}`;
  return '';
}

/**
 * Planned supplier payment totals for confirm dialogs (UZS buckets, USD buckets, legacy cost_total USD).
 */
export function plannedSupplierPaymentTotals(order) {
  if (!order) return { uzs: 0, usd: 0 };
  const usdBuckets =
    numOrZero(order.supplier_cost_usd_cash) + numOrZero(order.supplier_cost_usd_card);
  const uzsBuckets =
    numOrZero(order.supplier_cost_uzs_cash) + numOrZero(order.supplier_cost_uzs_card);
  const fromCostTotal = parseFloat(order.cost_total) || 0;
  if (uzsBuckets > 0) {
    return { uzs: uzsBuckets, usd: usdBuckets };
  }
  const usd = usdBuckets > 0 ? usdBuckets : fromCostTotal;
  return { uzs: 0, usd };
}
