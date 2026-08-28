import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import i18n from '../i18n';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildMonthlyStacked,
  buildTopSlots,
  buildNetMonthlyStacked,
  buildNetWeekdayAverages,
  buildOnDemandMonthly,
  buildSalesSeries,
  CHART_PALETTE,
  filterReturnFacts,
  crossFilterSummary,
  EMPTY_CROSS_FILTER,
  filterFacts,
  OTHERS_SLOT,
  slotKey,
  toggleCrossFilter,
} from '../utils/dashboardAnalytics';
import {
  MoneyBalanceCards,
  FinanceCards,
  FinanceCharts,
  NetProfitChart,
  MarketingCharts,
  MarketingPerItemChart,
  HrCharts,
  InventoryCharts,
  MgmtChart,
  SalesMgmtCharts,
  ToggleGroup,
  TopProductsBlock,
  tooltipStyle as mgmtTooltipStyle,
} from '../components/ManagementKpisSection';
import PenaltyDashboardCard from '../components/PenaltyDashboardCard';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import useManagementKpisData from '../hooks/useManagementKpisData';
import { formatAppDate } from '../utils/localeFormat';
import './Dashboard.css';

function KpiCard({ label, value, sub }) {
  return (
    <div className="dash-kpi-card">
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">{value}</div>
      {sub ? <div className="dash-kpi-sub">{sub}</div> : null}
    </div>
  );
}

/**
 * The hover box, with the empty rows left out.
 *
 * A stacked chart draws one series per person, and Recharts names every one of them on hover —
 * including everybody who sold nothing that day. On a weekday chart with a dozen salesmen that is
 * eleven lines of "0" hiding the one number the reader wanted.
 *
 * Only the rows are dropped, never a series: the colours, the legend and the stack order stay
 * exactly as they are, so the same person keeps the same colour on every bar.
 */
export function nonZeroTooltip({ active, payload, label }, tooltipStyle) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((entry) => Number(entry?.value) !== 0);
  // Nothing at all on this bar. An empty box reads as a glitch, so show none.
  if (!rows.length) return null;
  return (
    <div style={{ ...tooltipStyle, padding: '8px 10px' }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {rows.map((entry) => (
        <div key={entry.dataKey ?? entry.name} style={{ color: entry.color }}>
          {entry.name}
          {' : '}
          {typeof entry.value === 'number'
            ? Math.round(entry.value * 100) / 100
            : entry.value}
        </div>
      ))}
    </div>
  );
}

function ChartPanel({
  title,
  data,
  seriesKeys,
  xKey,
  chartType,
  onLegendClick,
  activeCross,
  emptyLabel = '',
  hideZeroSeries = false,
}) {
  const height = 280;

  const legendProps = {
    onClick: (e) => {
      const key = e?.value;
      if (!key || !onLegendClick) return;
      onLegendClick(key);
    },
    wrapperStyle: { cursor: 'pointer', fontSize: 12 },
  };

  const tooltipStyle = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 13,
  };

  if (!data?.length) {
    return (
      <div className="dash-chart-card">
        <h3>{title}</h3>
        <p className="dash-empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="dash-chart-card">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        {chartType === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              {...(hideZeroSeries
                ? { content: (props) => nonZeroTooltip(props, tooltipStyle) }
                : {})}
            />
            <Legend {...legendProps} />
            {seriesKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                fillOpacity={activeCross && activeCross !== key ? 0.25 : 0.75}
                strokeWidth={activeCross === key ? 2.5 : 1}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={chartType === 'weekday'} />
            <Tooltip
              contentStyle={tooltipStyle}
              {...(hideZeroSeries
                ? { content: (props) => nonZeroTooltip(props, tooltipStyle) }
                : {})}
            />
            <Legend {...legendProps} />
            {seriesKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="stack"
                fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                fillOpacity={activeCross && activeCross !== key ? 0.35 : 0.9}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** The leftover group is grey on purpose: it is a remainder, not a category to read into. */
const OTHERS_FILL = '#94a3b8';

/**
 * Units by category, where each bar shows only its own biggest sellers.
 *
 * Drives both category charts on the Sotuv tab — the monthly totals and the weekday averages.
 * They differ only in which field labels the bar and whether the values are whole numbers, so
 * `xKey` and `allowDecimals` carry that and the rest is shared.
 *
 * Its own component rather than a `ChartPanel` variant, because it is drawn on a different
 * principle. `ChartPanel` renders one series per category, which fixes the segment order for
 * the whole chart and puts every category — including the ones that sold nothing — into every
 * bar's tooltip. Here the series are positional slots, so each bar can be ordered biggest-at-
 * the-bottom on its own figures and can leave out whatever did not sell.
 *
 * That trade costs two things, and both are rebuilt by hand below:
 *
 * * **The tooltip**, because Recharts would name the series, and the series are called `slot0`.
 *   The real category travels beside each value in the row and is read from there.
 * * **The legend**, for the same reason, and because a slot has no colour of its own — colour
 *   belongs to the category, which is what stops a colour meaning two different things in two
 *   different bars.
 */
function CategoryTopSlotsChart({
  title,
  emptyLabel,
  series,
  labels,
  onLegendClick,
  activeCross,
  xKey = 'monthLabel',
  allowDecimals = false,
}) {
  const { data, slotCount, hasOthers, categoryColors, namedCategories } = series;

  const dimFor = (name) => (activeCross && activeCross !== name ? 0.3 : 0.9);

  const renderTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    const entries = [];
    for (let i = 0; i < slotCount; i += 1) {
      const name = row[`${slotKey(i)}Name`];
      const value = row[slotKey(i)];
      // A slot this month did not fill, or a category that sold none: neither belongs on hover.
      if (name && value > 0) entries.push({ name, value, fill: categoryColors[name] });
    }
    const others = row[OTHERS_SLOT] || 0;
    if (others > 0) {
      entries.push({
        name: labels.othersCount(row.othersNames?.length || 0),
        value: others,
        fill: OTHERS_FILL,
      });
    }
    if (!entries.length) return null;
    // Weekday values are averages, so the total is rounded rather than printed raw.
    const total = Math.round(entries.reduce((sum, e) => sum + e.value, 0) * 100) / 100;

    return (
      <div className="dash-chart-tooltip">
        <div className="dash-chart-tooltip__month">{row[xKey]}</div>
        {entries.map((e) => (
          <div className="dash-chart-tooltip__row" key={e.name}>
            <span className="dash-chart-legend__swatch" style={{ background: e.fill }} />
            <span className="dash-chart-tooltip__name">{e.name}</span>
            <span className="dash-chart-tooltip__value">{e.value}</span>
          </div>
        ))}
        <div className="dash-chart-tooltip__row dash-chart-tooltip__total">
          <span className="dash-chart-tooltip__name">{labels.total}</span>
          <span className="dash-chart-tooltip__value">{total}</span>
        </div>
      </div>
    );
  };

  if (!data?.length || slotCount === 0) {
    return (
      <div className="dash-chart-card">
        <h3>{title}</h3>
        <p className="dash-empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="dash-chart-card">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={allowDecimals} />
          <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
          {/* slot0 first, so Recharts puts the bar's biggest seller at the base. */}
          {Array.from({ length: slotCount }, (_, i) => (
            <Bar key={slotKey(i)} dataKey={slotKey(i)} stackId="stack">
              {data.map((row, rowIndex) => {
                const name = row[`${slotKey(i)}Name`];
                return (
                  <Cell
                    key={row.month_key || row[xKey] || rowIndex}
                    fill={categoryColors[name] || 'transparent'}
                    fillOpacity={dimFor(name)}
                  />
                );
              })}
            </Bar>
          ))}
          {hasOthers ? (
            <Bar
              dataKey={OTHERS_SLOT}
              stackId="stack"
              fill={OTHERS_FILL}
              fillOpacity={activeCross ? 0.3 : 0.9}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
      <div className="dash-chart-legend">
        {namedCategories.map((name) => (
          <button
            key={name}
            type="button"
            className={
              'dash-chart-legend__item dash-chart-legend__item--clickable'
              + (activeCross && activeCross !== name ? ' dash-chart-legend__item--dim' : '')
            }
            onClick={() => onLegendClick && onLegendClick(name)}
          >
            <span
              className="dash-chart-legend__swatch"
              style={{ background: categoryColors[name] }}
            />
            {name}
          </button>
        ))}
        {hasOthers ? (
          // Not clickable: it is a different set of categories in each bar, so there is
          // nothing single to filter the rest of the dashboard down to.
          <span className="dash-chart-legend__item">
            <span className="dash-chart-legend__swatch" style={{ background: OTHERS_FILL }} />
            {labels.others}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * On-demand orders per month, stacked by outcome.
 *
 * Drawn in the same idiom as the "Do'kon va yetkazib berish" chart: an `MgmtChart` card at
 * full width, 240px tall, dashed grid, 12/11px ticks.
 *
 * The three segments are exhaustive, so the bar's height *is* the month's total — which is
 * why the total is printed in the tooltip rather than drawn as a fourth bar. Stacking a
 * total on top of its own parts would double every bar.
 */
function OnDemandMonthlyChart({ title, hint, data, keys, totalLabel }) {
  // Sold green, still working amber, cancelled red — read bottom-up as the stack is drawn.
  const fills = ['#10b981', '#f59e0b', '#ef4444'];
  return (
    <MgmtChart title={title}>
      {hint ? <p className="dash-section-hint">{hint}</p> : null}
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            contentStyle={mgmtTooltipStyle}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={mgmtTooltipStyle} className="mgmt-tooltip">
                  <div><strong>{label}</strong></div>
                  {payload.map((entry) => (
                    <div key={entry.dataKey} style={{ color: entry.color }}>
                      {entry.name}: {entry.value}
                    </div>
                  ))}
                  <div style={{ marginTop: 4, borderTop: '1px solid #e2e8f0', paddingTop: 4 }}>
                    <strong>{totalLabel}: {payload[0]?.payload?.total ?? 0}</strong>
                  </div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              stackId="onDemand"
              fill={fills[i % fills.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </MgmtChart>
  );
}

/**
 * How many sales were made per period — a count of sale records, not money and not units.
 *
 * Distinct from the "donalar" charts on this tab, which count items: one sale of five shirts
 * is 1 here and 5 there. A single line on a whole-number axis, since there is one measure.
 */
function SalesCountChart({ title, data, granularity, onGranularityChange, labels }) {
  return (
    <MgmtChart
      title={title}
      controls={
        <ToggleGroup
          value={granularity}
          onChange={onGranularityChange}
          options={[
            { value: 'weekly', label: labels.weekly },
            { value: 'monthly', label: labels.monthly },
          ]}
        />
      }
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
          <Tooltip
            contentStyle={mgmtTooltipStyle}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={mgmtTooltipStyle} className="mgmt-tooltip">
                  <div><strong>{label}</strong></div>
                  <div>{labels.sales}: {payload[0]?.payload?.sales ?? 0}</div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="sales"
            name={labels.sales}
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </MgmtChart>
  );
}

const TAB_OVERALL = 'overall';
const TAB_FINANCE = 'finance';
const TAB_SALES = 'sales';
const TAB_MARKETING = 'marketing';
const TAB_HR = 'hr';
const TAB_INVENTORY = 'inventory';

const DashboardModern = () => {
  const { hasPermission, roleCode, isTargetolog } = usePermissions();
  const { t, monthOptions } = useAppTranslation(['dashboard', 'common', 'status']);
  // Memoized so it is stable across renders and can be a useMemo dependency below.
  const td = useCallback((key, opts) => t(key, { ns: 'dashboard', ...opts }), [t]);
  const targetologView = isTargetolog || roleCode === 'targetolog';
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('');
  const [crossFilter, setCrossFilter] = useState(EMPTY_CROSS_FILTER);
  const [activeTab, setActiveTab] = useState(TAB_OVERALL);
  const [cbuRate, setCbuRate] = useState(null);
  const [expensesGranularity, setExpensesGranularity] = useState('monthly');
  const [marketingGranularity, setMarketingGranularity] = useState('weekly');
  const [salesCountGranularity, setSalesCountGranularity] = useState('monthly');

  const loadAnalytics = useCallback(async (y) => {
    try {
      const res = await api.get('/dashboard/analytics/', { params: { year: y } });
      setAnalytics(res.data);
      setError(null);
    } catch (err) {
      setError(i18n.t('analyticsLoadError', { ns: 'dashboard' }));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAnalytics(year);
  }, [year, loadAnalytics]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/exchange-rate/')
      .then((res) => {
        if (!cancelled) setCbuRate(res.data || null);
      })
      .catch(() => {
        if (!cancelled) setCbuRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canViewMgmt = hasPermission('dashboard.ceo');
  const canViewMarketing = canViewMgmt || hasPermission('marketing_analytics.view');
  const mgmtMarketingOnly = !canViewMgmt && canViewMarketing;

  const { data: mgmtData, loading: mgmtLoading, turnoverLoading } = useManagementKpisData({
    year,
    month,
    expensesGranularity,
    marketingGranularity,
    enabled: canViewMarketing,
    marketingOnly: mgmtMarketingOnly,
    errorMessage: t('mgmt.loadError', { ns: 'dashboard' }),
  });

  const monthNum = month ? parseInt(month, 10) : null;

  const filteredFacts = useMemo(() => {
    if (!analytics?.facts) return [];
    return filterFacts(analytics.facts, {
      year: analytics.year,
      month: monthNum,
      crossFilter,
    });
  }, [analytics, monthNum, crossFilter]);

  const filteredReturnFacts = useMemo(() => {
    if (!analytics?.return_facts) return [];
    return filterReturnFacts(analytics.return_facts, {
      year: analytics.year,
      month: monthNum,
      crossFilter,
    });
  }, [analytics, monthNum, crossFilter]);

  const monthlyUsers = useMemo(
    () => buildNetMonthlyStacked(filteredFacts, filteredReturnFacts, 'salesman_name'),
    [filteredFacts, filteredReturnFacts],
  );
  const monthlyOrdersByUser = useMemo(
    () => buildMonthlyStacked(filteredFacts, 'salesman_name', () => 1),
    [filteredFacts],
  );
  const monthlyCategories = useMemo(
    () => buildNetMonthlyStacked(filteredFacts, filteredReturnFacts, 'category'),
    [filteredFacts, filteredReturnFacts],
  );
  // Recast into each month's own top sellers — see `buildTopSlots`.
  const monthlyCategoryTop = useMemo(
    () => buildTopSlots(monthlyCategories, 5),
    [monthlyCategories],
  );
  const monthlyCustomers = useMemo(
    () => buildNetMonthlyStacked(filteredFacts, filteredReturnFacts, 'customer_type'),
    [filteredFacts, filteredReturnFacts],
  );
  // Built from the same cross-filtered facts as the chart beside it, so clicking a legend
  // narrows both together.
  const salesCount = useMemo(
    () => buildSalesSeries(filteredFacts, salesCountGranularity),
    [filteredFacts, salesCountGranularity],
  );

  const weekdayUsers = useMemo(
    () => buildNetWeekdayAverages(filteredFacts, filteredReturnFacts, 'salesman_name'),
    [filteredFacts, filteredReturnFacts],
  );
  const weekdayCategories = useMemo(
    () => buildNetWeekdayAverages(filteredFacts, filteredReturnFacts, 'category'),
    [filteredFacts, filteredReturnFacts],
  );
  // Same treatment as the monthly chart: each weekday keeps its own five, the rest grouped.
  const weekdayCategoryTop = useMemo(
    () => buildTopSlots(weekdayCategories, 5),
    [weekdayCategories],
  );
  const weekdayCustomers = useMemo(
    () => buildNetWeekdayAverages(filteredFacts, filteredReturnFacts, 'customer_type'),
    [filteredFacts, filteredReturnFacts],
  );

  const handleLegendUser = (name) => {
    setCrossFilter((c) => toggleCrossFilter(c, { salesman: name }));
  };
  const handleLegendCategory = (name) => {
    setCrossFilter((c) => toggleCrossFilter(c, { category: name }));
  };
  const handleLegendCustomer = (name) => {
    setCrossFilter((c) => toggleCrossFilter(c, { customerType: name }));
  };

  const clearCrossFilter = () => setCrossFilter(EMPTY_CROSS_FILTER);

  const kpis = analytics?.kpis;
  const filterHint = crossFilterSummary(crossFilter);
  const isExecutiveView = canViewMgmt || Boolean(analytics?.company_wide);

  /**
   * One card per on-demand order status, following the Yil/Oy filter.
   *
   * The backend pre-aggregates per (month, status) — a count cannot be re-filtered once it
   * has been summed, so the month split has to survive the trip for the Oy filter to work
   * here the way it already does for the charts.
   *
   * Every status is always rendered, in workflow order, including the ones at zero: the row
   * is a pipeline, and a stage vanishing when it empties would make the shape jump around.
   */
  /** Monthly bars, deliberately unfiltered by Oy — the chart's whole job is to show the
   *  months side by side. */
  const onDemandMonthly = useMemo(
    () => buildOnDemandMonthly(analytics?.on_demand_order_facts, {
      sold: td('onDemandSeriesSold'),
      inProcess: td('onDemandSeriesInProcess'),
      cancelled: td('onDemandSeriesCancelled'),
    }),
    [analytics, td],
  );

  const cbuRateLine = useMemo(() => {
    if (!cbuRate?.rate) return null;
    const rateNum = Number(cbuRate.rate);
    if (!Number.isFinite(rateNum)) return null;
    const dateLabel = cbuRate.rate_date ? formatAppDate(cbuRate.rate_date) : '';
    return t('cbuRateLine', {
      ns: 'dashboard',
      rate: rateNum.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      date: dateLabel,
    });
  }, [cbuRate, t]);

  const tabs = [
    { key: TAB_OVERALL, label: td('tabOverall'), visible: true },
    { key: TAB_FINANCE, label: td('tabFinance'), visible: canViewMgmt },
    { key: TAB_SALES, label: td('tabSales'), visible: true },
    { key: TAB_MARKETING, label: td('tabMarketing'), visible: canViewMarketing },
    { key: TAB_HR, label: td('tabHr'), visible: !targetologView },
    { key: TAB_INVENTORY, label: td('tabInventory'), visible: canViewMgmt },
  ].filter((tb) => tb.visible);

  useEffect(() => {
    if (!tabs.some((tb) => tb.key === activeTab)) {
      setActiveTab(TAB_OVERALL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map((tb) => tb.key).join(',')]);

  if (loading) {
    return <div className="page-container">{td('loading')}</div>;
  }
  if (error) {
    return <div className="page-container error">{error}</div>;
  }

  const chartEmpty = td('noChartData');
  // Plain object, not memoized: this sits below the loading/error returns, where a hook would
  // not run on every render. It is three strings and a closure.
  const categoryChartLabels = {
    others: td('chartOthers'),
    othersCount: (count) => td('chartOthersCount', { count }),
    total: td('chartMonthTotal'),
  };

  const formatRefundSummary = (usd, uzs) => {
    const parts = [];
    if ((usd ?? 0) > 0) {
      parts.push(
        `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      );
    }
    if ((uzs ?? 0) > 0) {
      parts.push(`${uzs.toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS`);
    }
    return parts.join(' · ');
  };

  return (
    <div className="dashboard dash-bi">
      <header className="dash-header dash-header-page">
        <div>
          <h1>{td('title')}</h1>
          <p className="dash-subtitle">
            {isExecutiveView
              ? td('subtitleExecutive')
              : analytics?.company_wide
                ? td('subtitleCompany')
                : td('subtitleOwn')}
            {filterHint ? ` · ${td('filtered')}: ${filterHint}` : ''}
          </p>
          {cbuRateLine ? <p className="dash-subtitle">{cbuRateLine}</p> : null}
        </div>
        <div className="dash-filters">
          <label>
            {t('filters.year', { ns: 'common' })}
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
              {(analytics?.available_years || [year]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('filters.month', { ns: 'common' })}
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthOptions.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {filterHint ? (
            <button type="button" className="dash-clear-filter" onClick={clearCrossFilter}>
              {td('clearChartFilters')}
            </button>
          ) : null}
        </div>
      </header>

      {tabs.length > 1 ? (
        <div className="dash-tab-bar" role="tablist" aria-label={td('title')}>
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tb.key}
              className={activeTab === tb.key ? 'dash-tab active' : 'dash-tab'}
              onClick={() => setActiveTab(tb.key)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === TAB_OVERALL && (
        <>
          <section className="dash-kpi-row">
            <KpiCard
              label={td('soldUnitsToday')}
              value={(kpis?.net_sold_units ?? kpis?.sold_units ?? 0).toLocaleString()}
              sub={
                // Same-day returns only, matching what the figure above nets off. A return of
                // something sold last week belongs to the Qaytarishlar card, not here — showing
                // it under a number it was never subtracted from made the two look like they
                // disagreed.
                !targetologView && (kpis?.same_day_return_units ?? 0) > 0
                  ? td('netUnitsSub', {
                      gross: (kpis?.sold_units ?? 0).toLocaleString(),
                      returned: (kpis?.same_day_return_units ?? 0).toLocaleString(),
                    })
                  : kpis?.scope === 'own'
                    ? td('scopeOwn')
                    : td('scopeAll')
              }
            />
            {!targetologView ? (
              <KpiCard
                label={td('salesRevenueTodayUsd')}
                value={`$${(kpis?.net_revenue_usd ?? kpis?.revenue_usd ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}`}
                sub={
                  (kpis?.refunds_usd ?? 0) > 0
                    ? td('netRevenueSub', { refunds: formatRefundSummary(kpis?.refunds_usd, 0) })
                    : null
                }
              />
            ) : null}
            {!targetologView ? (
              <KpiCard
                label={td('salesRevenueTodayUzs')}
                value={`${(kpis?.net_revenue_uzs ?? kpis?.revenue_uzs ?? 0).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })} UZS`}
                sub={
                  (kpis?.refunds_uzs ?? 0) > 0
                    ? td('netRevenueSub', { refunds: formatRefundSummary(0, kpis?.refunds_uzs) })
                    : null
                }
              />
            ) : null}
            <KpiCard
              label={td('ordersToday')}
              value={(kpis?.total_orders ?? 0).toLocaleString()}
            />
            <KpiCard
              label={td('returnsToday')}
              value={(kpis?.total_returns ?? 0).toLocaleString()}
              sub={
                !targetologView && ((kpis?.refunds_usd ?? 0) > 0 || (kpis?.refunds_uzs ?? 0) > 0)
                  ? td('returnsRefundSub', {
                      refunds: formatRefundSummary(kpis?.refunds_usd, kpis?.refunds_uzs),
                    })
                  : td('returnedUnits')
              }
            />
          </section>

          {canViewMgmt ? (
            <section className="mgmt-section">
              <MoneyBalanceCards data={mgmtData} />
              <div className="mgmt-grid">
                <NetProfitChart data={mgmtData} />
                <MarketingPerItemChart
                  data={mgmtData}
                  marketingGranularity={marketingGranularity}
                  setMarketingGranularity={setMarketingGranularity}
                />
              </div>
            </section>
          ) : null}
        </>
      )}

      {activeTab === TAB_FINANCE && canViewMgmt && (
        <section className="mgmt-section">
          <MoneyBalanceCards data={mgmtData} />
          <FinanceCards data={mgmtData} turnoverLoading={turnoverLoading || mgmtLoading} />
          <FinanceCharts
            data={mgmtData}
            expensesGranularity={expensesGranularity}
            setExpensesGranularity={setExpensesGranularity}
          />
        </section>
      )}

      {activeTab === TAB_SALES && (
        <>
          {/* The status-card row and its heading are gone; the chart carries its own title
              and now shows the same breakdown across every month instead of one period. */}
          <section className="dash-section">
            <div className="mgmt-charts-grid">
              <OnDemandMonthlyChart
                title={td('onDemandMonthlyChart')}
                hint={td('onDemandMonthlyHint')}
                data={onDemandMonthly.data}
                keys={onDemandMonthly.keys}
                totalLabel={td('onDemandSeriesTotal')}
              />
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">{td('monthlyPerformance')}</h2>
            <p className="dash-section-hint">{td('monthlyHint')}</p>
            <p className="dash-section-hint">{td('returnsChartHint')}</p>
            <div className="dash-charts-row">
              {!targetologView ? (
                <CategoryTopSlotsChart
                  emptyLabel={chartEmpty}
                  title={td('chartUnitsByCategory')}
                  series={monthlyCategoryTop}
                  labels={categoryChartLabels}
                  onLegendClick={handleLegendCategory}
                  activeCross={crossFilter.category}
                />
              ) : null}
              <SalesCountChart
                title={td('salesCountChart')}
                data={salesCount}
                granularity={salesCountGranularity}
                onGranularityChange={setSalesCountGranularity}
                labels={{
                  weekly: td('mgmt.weekly'),
                  monthly: td('mgmt.monthly'),
                  sales: td('salesCountSeries'),
                }}
              />
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">{td('weekdayAverages')}</h2>
            <p className="dash-section-hint">{td('weekdayHint')}</p>
            <div className="dash-charts-row">
              {!targetologView ? (
                <CategoryTopSlotsChart
                  emptyLabel={chartEmpty}
                  title={td('chartAvgByCategory')}
                  series={weekdayCategoryTop}
                  labels={categoryChartLabels}
                  xKey="weekday_label"
                  allowDecimals
                  onLegendClick={handleLegendCategory}
                  activeCross={crossFilter.category}
                />
              ) : null}
              <ChartPanel
                emptyLabel={chartEmpty}
                title={td('chartAvgByCustomer')}
                data={weekdayCustomers.data}
                seriesKeys={weekdayCustomers.keys}
                xKey="weekday_label"
                chartType="bar"
                onLegendClick={handleLegendCustomer}
                activeCross={crossFilter.customerType}
              />
            </div>
          </section>

          {canViewMgmt ? (
            <section className="mgmt-section">
              <SalesMgmtCharts data={mgmtData} />
              <TopProductsBlock data={mgmtData} />
            </section>
          ) : null}
        </>
      )}

      {activeTab === TAB_MARKETING && canViewMarketing && (
        <>
          <section className="dash-section">
            <div className="dash-charts-row">
              <ChartPanel
                emptyLabel={chartEmpty}
                title={td('chartNewVsExisting')}
                data={monthlyCustomers.data}
                seriesKeys={monthlyCustomers.keys}
                xKey="monthLabel"
                chartType="area"
                onLegendClick={handleLegendCustomer}
                activeCross={crossFilter.customerType}
              />
            </div>
          </section>
          <section className="mgmt-section">
            <MarketingCharts data={mgmtData} />
          </section>
        </>
      )}

      {activeTab === TAB_HR && !targetologView && (
        <>
          <PenaltyDashboardCard />
          <section className="dash-section">
            <h2 className="dash-section-title">{td('monthlyPerformance')}</h2>
            <div className="dash-charts-row">
              <ChartPanel
                emptyLabel={chartEmpty}
                title={td('chartUnitsByUser')}
                data={monthlyUsers.data}
                seriesKeys={monthlyUsers.keys}
                xKey="monthLabel"
                chartType="bar"
                onLegendClick={handleLegendUser}
                activeCross={crossFilter.salesman}
              />
              <ChartPanel
                emptyLabel={chartEmpty}
                title={td('chartOrdersByUser')}
                data={monthlyOrdersByUser.data}
                seriesKeys={monthlyOrdersByUser.keys}
                xKey="monthLabel"
                chartType="bar"
                onLegendClick={handleLegendUser}
                activeCross={crossFilter.salesman}
              />
            </div>
          </section>
          <section className="dash-section">
            <h2 className="dash-section-title">{td('weekdayAverages')}</h2>
            <div className="dash-charts-row">
              <ChartPanel
                emptyLabel={chartEmpty}
                title={td('chartAvgByUser')}
                data={weekdayUsers.data}
                seriesKeys={weekdayUsers.keys}
                xKey="weekday_label"
                chartType="weekday"
                // Everyone who sold nothing on that weekday is left out of the hover, so the
                // people who did sell are not buried under a column of zeroes.
                hideZeroSeries
                onLegendClick={handleLegendUser}
                activeCross={crossFilter.salesman}
              />
            </div>
          </section>
          {canViewMgmt ? (
            <section className="mgmt-section">
              <HrCharts data={mgmtData} />
            </section>
          ) : null}
        </>
      )}

      {activeTab === TAB_INVENTORY && canViewMgmt && (
        <section className="mgmt-section">
          <InventoryCharts data={mgmtData} />
        </section>
      )}
    </div>
  );
};

export default DashboardModern;
