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
export function buildNetWeekdayAverages(saleFacts, returnFacts, dimensionField, granularity = 'monthly') {
  const sale = buildWeekdayAveragesFixed(saleFacts, dimensionField, granularity);
  if (!returnFacts?.length) return sale;

  const ret = buildWeekdayAveragesFixed(returnFacts, dimensionField, granularity);
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
export function buildWeekdayAveragesFixed(facts, dimensionField, granularity = 'monthly') {
  const keys = uniqueKeys(facts, dimensionField);
  const sliceTotals = new Map();

  for (const f of facts) {
    const wd = f.weekday;
    // The slice is what gets averaged over, and it is the whole meaning of the number:
    //
    //   monthly — "in an average month, Mondays sold this much" (every Monday in the month
    //             added together, then averaged across months);
    //   weekly  — "on a typical Monday, this much" (one Monday per week, averaged across weeks).
    //
    // Same bars, same data, two different questions — which is why the weekday axis stays.
    // `week_key` falls back to the month rather than being assumed present: a payload cached
    // before returns carried one would otherwise bucket every fact under `undefined` and average
    // the whole year into a single slice.
    const bucket = (granularity === 'weekly' ? f.week_key : f.month_key) || f.month_key;
    const sliceKey = `${bucket}-${wd}`;
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
/**
 * Units sold per period, returns taken off.
 *
 * This used to add 1 per sale rather than the units on it, so one sale of five pairs of shoes
 * counted as one — a line labelled "sold" that no other chart on the page could be reconciled
 * against. It now counts units, net of returns, the same way the category chart beside it does,
 * so the two can be read together.
 *
 * `sold` and `returned` are kept as well as `sales` so a tooltip can show the gross figure and
 * what came back, rather than only the difference.
 */
export function buildSalesSeries(facts, returnFacts = null, granularity = 'monthly') {
  const rows = new Map();
  const keyOf = (f) =>
    granularity === 'weekly' ? f.week_key : `${f.month}`.padStart(2, '0');
  const blank = (period) => ({
    period, revenue_usd: 0, revenue_uzs: 0, sales: 0, sold: 0, returned: 0,
  });

  if (granularity === 'monthly') {
    for (let m = 1; m <= 12; m += 1) {
      rows.set(`${m}`.padStart(2, '0'), blank(MONTH_NAMES[m - 1] || String(m)));
    }
  }

  const rowFor = (fact) => {
    const key = keyOf(fact);
    if (!key) return null;
    if (!rows.has(key)) {
      rows.set(key, blank(
        granularity === 'weekly'
          ? fact.week_label || key
          : MONTH_NAMES[Number(fact.month) - 1] || key,
      ));
    }
    return rows.get(key);
  };

  for (const fact of facts || []) {
    const row = rowFor(fact);
    if (!row) continue;
    row.revenue_usd += Number(fact.revenue_usd) || 0;
    row.revenue_uzs += Number(fact.revenue_uzs) || 0;
    row.sold += Number(fact.units) || 0;
  }

  for (const fact of returnFacts || []) {
    const row = rowFor(fact);
    if (!row) continue;
    row.returned += Number(fact.units) || 0;
  }

  for (const row of rows.values()) {
    // Floored for the same reason every other net figure here is: a return processed in a later
    // period than its sale would otherwise draw a line below zero, which reads as negative sales.
    row.sales = Math.max(row.sold - row.returned, 0);
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

/** Slot dataKey for the leftover group; every bar's top segment when there is one. */
export const OTHERS_SLOT = 'slot_others';

/** Slot dataKeys are positional — `slot0` is the biggest seller of that month, not a category. */
export const slotKey = (index) => `slot${index}`;

/**
 * Recast a stacked-by-category series so each bar shows only its own biggest sellers.
 *
 * The charts it replaces drew one series per category that had *ever* sold, so a bar listed
 * every category in the business on hover, most of them zero, and the ones that mattered were
 * lost among them.
 *
 * **Slots, not categories.** Each bar is built from `slot0…slot{limit-1}` plus the leftovers,
 * where `slot0` is that bar's biggest seller — so the segments are ordered biggest-at-the-
 * bottom within each bar, and a category can sit in a different slot from one bar to the
 * next. That is what "the top 5 of each bar" means and it cannot be done with one series per
 * category, because the series order is fixed for the whole chart.
 *
 * The cost of slots is that position no longer identifies a category, so **colour has to**:
 * `categoryColors` maps each category to one colour for the life of the chart, and the caller
 * paints each segment from the name travelling beside it (`slot0Name` and friends). Without
 * that the same colour would mean a different category in every bar, which is the one thing
 * that makes a stacked chart unreadable.
 *
 * Zero-selling categories are dropped outright rather than drawn flat: a segment of no height
 * is invisible on screen but still shows up on hover, which is the complaint this answers.
 *
 * Takes months (`buildNetMonthlyStacked`) or weekdays (`buildNetWeekdayAverages`) alike: the
 * bucket's own fields — `month_key`/`monthLabel`, or `weekday_label` — are whatever is on the
 * row besides the categories, and are copied through untouched for the axis to label with.
 * Weekday rows carry averages, so values are not assumed to be whole numbers.
 *
 * @param {{data: object[], keys: string[]}} series - a stacked-by-category series
 * @param {number} limit - how many named categories each bar keeps
 */
export function buildTopSlots(series, limit = 5) {
  const rows = series?.data || [];
  const keys = series?.keys || [];

  // One colour per category for the whole chart, handed out by overall size so the biggest
  // sellers get the front of the palette and keep their colour as months come and go.
  const totals = new Map();
  for (const key of keys) {
    let sum = 0;
    for (const row of rows) sum += Number(row[key]) || 0;
    if (sum > 0) totals.set(key, sum);
  }
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  const categoryColors = {};
  ranked.forEach((name, i) => {
    categoryColors[name] = CHART_PALETTE[i % CHART_PALETTE.length];
  });

  const categoryFields = new Set(keys);
  let slotCount = 0;
  let anyOthers = false;
  const data = rows.map((row) => {
    const sold = keys
      .map((name) => ({ name, value: Number(row[name]) || 0 }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    const top = sold.slice(0, limit);
    const rest = sold.slice(limit);
    slotCount = Math.max(slotCount, top.length);

    // Everything that is not a category is the bucket's own identity — the month key and
    // label, or the weekday label. Copied through so the axis has something to print.
    const next = {};
    for (const [field, value] of Object.entries(row)) {
      if (!categoryFields.has(field)) next[field] = value;
    }
    top.forEach((entry, i) => {
      next[slotKey(i)] = entry.value;
      next[`${slotKey(i)}Name`] = entry.name;
    });
    if (rest.length) {
      anyOthers = true;
      // Rounded because weekday rows are averages: adding 1.1 and 2.2 raw prints
      // 3.3000000000000003 on hover. Whole-number months are unaffected.
      next[OTHERS_SLOT] = Math.round(
        rest.reduce((sum, entry) => sum + entry.value, 0) * 100,
      ) / 100;
      next.othersNames = rest.map((entry) => entry.name);
    }
    return next;
  });

  return {
    data,
    slotCount,
    hasOthers: anyOthers,
    categoryColors,
    /** Categories that reach some month's top slots — what the legend can offer. */
    namedCategories: [...new Set(
      data.flatMap((row) => Array.from(
        { length: slotCount }, (_, i) => row[`${slotKey(i)}Name`],
      ).filter(Boolean)),
    )].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b)),
  };
}
