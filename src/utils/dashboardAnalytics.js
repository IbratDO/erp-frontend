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

/**
 * Monthly on-demand order counts for the Sotuv bar chart, from the same
 * `on_demand_order_facts` rows the status endpoint already returns — no second request.
 *
 * Three series, keyed by the labels the caller passes in so they stay translatable:
 *   sold       those now at `sold`
 *   inProcess  raised but not yet finished — anything neither sold nor cancelled
 *   cancelled  those now at `cancelled`
 *
 * **The three are exhaustive and mutually exclusive, which is what lets the bars stack.**
 * Every on-demand order is in exactly one of them, so the stack height is the month's total
 * and `total` is carried on each row for the tooltip rather than drawn as a fourth bar —
 * stacking a total on top of its own parts would draw every bar at twice its real height.
 *
 * `inProcess` is deliberately defined as *the remainder* rather than as a list of pipeline
 * statuses. Listing them meant `in_inventory` belonged to no series at all and silently
 * vanished from the chart while still counting in the total; as a remainder, a status added
 * to the workflow later shows up on its own instead of disappearing.
 */
/**
 * Sales per period: how many were made (`sales`), and what came in (`revenue_usd`/`_uzs`).
 *
 * `sales` counts **sale records, not items** — one sale of five shirts is 1 here and 5 in the
 * "donalar" charts on the same tab. That is what the Sotuvlar soni line plots.
 *
 * The revenue figures ride along unused by that chart, kept per currency rather than summed:
 * they are the money that actually arrived in each, and adding them needs a rate the facts do
 * not carry. Inventing one would put a number on the dashboard that the balance sheet
 * disagrees with.
 *
 * Monthly seeds all twelve months so the line reads as a calendar rather than as "the months
 * that happened to have sales". Weekly does not: an empty calendar year is 52 mostly-flat
 * points, so it shows only weeks with activity, like the marketing charts.
 */
export function buildSalesSeries(facts, granularity = 'monthly') {
  const rows = new Map();

  if (granularity === 'monthly') {
    for (let m = 1; m <= 12; m += 1) {
      rows.set(`${m}`.padStart(2, '0'), {
        period: MONTH_NAMES[m - 1] || String(m),
        revenue_usd: 0,
        revenue_uzs: 0,
        sales: 0,
      });
    }
  }

  for (const fact of facts || []) {
    const key = granularity === 'weekly' ? fact.week_key : `${fact.month}`.padStart(2, '0');
    if (!key) continue;
    if (!rows.has(key)) {
      rows.set(key, {
        period: granularity === 'weekly'
          ? fact.week_label || key
          : MONTH_NAMES[Number(fact.month) - 1] || key,
        revenue_usd: 0,
        revenue_uzs: 0,
        sales: 0,
      });
    }
    const row = rows.get(key);
    row.revenue_usd += Number(fact.revenue_usd) || 0;
    row.revenue_uzs += Number(fact.revenue_uzs) || 0;
    row.sales += 1;
  }

  return [...rows.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}

export function buildOnDemandMonthly(facts, labels) {
  // Every month of the year is present, empty ones included, so the bars read as a
  // calendar rather than as "the two months that happened to have orders".
  const byMonth = new Map();
  for (let m = 1; m <= 12; m += 1) {
    byMonth.set(m, {
      month: m,
      monthLabel: MONTH_NAMES[m - 1] || String(m),
      total: 0,
      [labels.sold]: 0,
      [labels.inProcess]: 0,
      [labels.cancelled]: 0,
    });
  }

  for (const fact of facts || []) {
    const m = Number(fact.month);
    if (!Number.isFinite(m) || m < 1 || m > 12) continue;
    const row = byMonth.get(m);
    const count = Number(fact.count) || 0;
    row.total += count;
    if (fact.status === 'sold') row[labels.sold] += count;
    else if (fact.status === 'cancelled') row[labels.cancelled] += count;
    else row[labels.inProcess] += count;
  }

  return {
    data: [...byMonth.values()].sort((a, b) => a.month - b.month),
    // Bottom of the stack first: finished work at the base, cancellations on top.
    keys: [labels.sold, labels.inProcess, labels.cancelled],
  };
}
