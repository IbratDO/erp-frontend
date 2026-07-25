/** Client-side transforms for dashboard sale facts (cross-filter + chart series). */

export const CHART_PALETTE = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const EMPTY_CROSS_FILTER = {
  salesman: null,
  category: null,
  customerType: null,
};

export function filterFacts(facts, { year, month, crossFilter }) {
  return (facts || []).filter((f) => {
    if (year && f.year !== year) return false;
    if (month && f.month !== month) return false;
    if (crossFilter.salesman && f.salesman_name !== crossFilter.salesman) return false;
    if (crossFilter.category && f.category !== crossFilter.category) return false;
    if (crossFilter.customerType && f.customer_type !== crossFilter.customerType) return false;
    return true;
  });
}

export function filterReturnFacts(returnFacts, { year, month, crossFilter }) {
  return filterFacts(returnFacts, { year, month, crossFilter });
}

/** Monthly stacked units with returns subtracted (by return_date month). */
export function buildNetMonthlyStacked(saleFacts, returnFacts, dimensionField) {
  const sale = buildMonthlyStacked(saleFacts, dimensionField);
  if (!returnFacts?.length) return sale;

  const retStack = buildMonthlyStacked(returnFacts, dimensionField);
  const retKeys = new Set(retStack.keys);
  const keys = [...new Set([...sale.keys, ...retKeys])].sort();

  const data = sale.data.map((row) => {
    const retRow = retStack.data.find((r) => r.month_key === row.month_key) || {};
    const next = { ...row };
    for (const k of keys) {
      const sold = row[k] || 0;
      const returned = retRow[k] || 0;
      next[k] = Math.max(sold - returned, 0);
    }
    return next;
  });

  return { data, keys };
}

/** Weekday averages with returns subtracted per slice. */
export function buildNetWeekdayAverages(saleFacts, returnFacts, dimensionField) {
  const sale = buildWeekdayAveragesFixed(saleFacts, dimensionField);
  if (!returnFacts?.length) return sale;

  const ret = buildWeekdayAveragesFixed(returnFacts, dimensionField);
  const keys = [...new Set([...sale.keys, ...ret.keys])].sort();

  const retByLabel = Object.fromEntries(ret.data.map((r) => [r.weekday_label, r]));
  const data = sale.data.map((row) => {
    const retRow = retByLabel[row.weekday_label] || {};
    const next = { ...row };
    for (const k of keys) {
      next[k] = Math.max((row[k] || 0) - (retRow[k] || 0), 0);
    }
    return next;
  });

  return { data, keys };
}

function uniqueKeys(facts, field) {
  return [...new Set(facts.map((f) => f[field]).filter(Boolean))].sort();
}

function monthLabel(monthKey) {
  const [, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  return MONTH_NAMES[idx] || m;
}

/**
 * Stacked series by month for a dimension field (salesman_name | category | customer_type).
 * `valueFn` picks the value summed per fact row — defaults to unit quantity;
 * pass `() => 1` to count records (e.g. number of sales) instead.
 */
export function buildMonthlyStacked(facts, dimensionField, valueFn = (f) => f.units) {
  const keys = uniqueKeys(facts, dimensionField);
  const byMonth = new Map();

  for (const f of facts) {
    const mk = f.month_key;
    if (!byMonth.has(mk)) {
      byMonth.set(mk, { month_key: mk, monthLabel: monthLabel(mk) });
    }
    const row = byMonth.get(mk);
    const dim = f[dimensionField] || 'Other';
    row[dim] = (row[dim] || 0) + valueFn(f);
  }

  return {
    data: [...byMonth.values()].sort((a, b) => a.month_key.localeCompare(b.month_key)),
    keys,
  };
}

/** Average units per weekday (mean per month-weekday slice in filtered data). */
export function buildWeekdayAveragesFixed(facts, dimensionField) {
  const keys = uniqueKeys(facts, dimensionField);
  const sliceTotals = new Map();

  for (const f of facts) {
    const wd = f.weekday;
    const sliceKey = `${f.month_key}-${wd}`;
    const dim = f[dimensionField] || 'Other';
    if (!sliceTotals.has(sliceKey)) {
      sliceTotals.set(sliceKey, { weekday: wd, weekday_label: f.weekday_label, dims: {} });
    }
    const s = sliceTotals.get(sliceKey);
    s.dims[dim] = (s.dims[dim] || 0) + f.units;
  }

  const byWeekday = new Map();
  for (const s of sliceTotals.values()) {
    if (!byWeekday.has(s.weekday)) {
      byWeekday.set(s.weekday, { weekday_label: s.weekday_label, slices: [], keys: new Set() });
    }
    const b = byWeekday.get(s.weekday);
    b.slices.push(s.dims);
    Object.keys(s.dims).forEach((k) => b.keys.add(k));
  }

  const data = [...byWeekday.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => {
      const denom = Math.max(b.slices.length, 1);
      const row = { weekday_label: b.weekday_label };
      for (const k of keys) {
        let sum = 0;
        for (const sl of b.slices) sum += sl[k] || 0;
        row[k] = Math.round((sum / denom) * 10) / 10;
      }
      return row;
    });

  return { data, keys };
}

export function toggleCrossFilter(current, patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (next[key] === value) next[key] = null;
    else next[key] = value;
  }
  return next;
}

export function crossFilterSummary(crossFilter) {
  const parts = [];
  if (crossFilter.salesman) parts.push(`User: ${crossFilter.salesman}`);
  if (crossFilter.category) parts.push(`Category: ${crossFilter.category}`);
  if (crossFilter.customerType) parts.push(crossFilter.customerType);
  return parts.length ? parts.join(' · ') : null;
}
