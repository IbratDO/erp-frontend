import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import i18n from '../i18n';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildMonthlyStacked,
  buildNetMonthlyStacked,
  buildNetWeekdayAverages,
  CHART_PALETTE,
  filterReturnFacts,
  crossFilterSummary,
  EMPTY_CROSS_FILTER,
  filterFacts,
  toggleCrossFilter,
} from '../utils/dashboardAnalytics';
import {
  MoneyBalanceCards,
  FinanceCards,
  FinanceCharts,
  NetProfitChart,
  MarketingCharts,
  HrCharts,
  InventoryCharts,
  SalesMgmtCharts,
  TopProductsBlock,
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

function ChartPanel({
  title,
  data,
  seriesKeys,
  xKey,
  chartType,
  onLegendClick,
  activeCross,
  emptyLabel = '',
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
            <Tooltip contentStyle={tooltipStyle} />
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
            <Tooltip contentStyle={tooltipStyle} />
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

const TAB_OVERALL = 'overall';
const TAB_FINANCE = 'finance';
const TAB_SALES = 'sales';
const TAB_MARKETING = 'marketing';
const TAB_HR = 'hr';
const TAB_INVENTORY = 'inventory';

const DashboardModern = () => {
  const { hasPermission, roleCode, isTargetolog } = usePermissions();
  const { t, monthOptions } = useAppTranslation(['dashboard', 'common']);
  const td = (key, opts) => t(key, { ns: 'dashboard', ...opts });
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
  const monthlyCustomers = useMemo(
    () => buildNetMonthlyStacked(filteredFacts, filteredReturnFacts, 'customer_type'),
    [filteredFacts, filteredReturnFacts],
  );

  const weekdayUsers = useMemo(
    () => buildNetWeekdayAverages(filteredFacts, filteredReturnFacts, 'salesman_name'),
    [filteredFacts, filteredReturnFacts],
  );
  const weekdayCategories = useMemo(
    () => buildNetWeekdayAverages(filteredFacts, filteredReturnFacts, 'category'),
    [filteredFacts, filteredReturnFacts],
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
                !targetologView && (kpis?.total_returns ?? 0) > 0
                  ? td('netUnitsSub', {
                      gross: (kpis?.sold_units ?? 0).toLocaleString(),
                      returned: (kpis?.total_returns ?? 0).toLocaleString(),
                    })
                  : kpis?.scope === 'own'
                    ? td('scopeOwn')
                    : td('scopeAll')
              }
            />
            {!targetologView ? (
              <KpiCard
                label={td('salesRevenueToday')}
                value={`$${(kpis?.net_revenue_usd ?? kpis?.revenue_usd ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}`}
                sub={
                  (kpis?.refunds_usd ?? 0) > 0 || (kpis?.refunds_uzs ?? 0) > 0
                    ? td('netRevenueSub', {
                        refunds: formatRefundSummary(kpis?.refunds_usd, kpis?.refunds_uzs),
                      })
                    : (kpis?.net_revenue_uzs ?? kpis?.revenue_uzs ?? 0) > 0
                      ? `${(kpis.net_revenue_uzs ?? kpis.revenue_uzs).toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS`
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
          <section className="dash-section">
            <h2 className="dash-section-title">{td('monthlyPerformance')}</h2>
            <p className="dash-section-hint">{td('monthlyHint')}</p>
            <p className="dash-section-hint">{td('returnsChartHint')}</p>
            <div className="dash-charts-row">
              {!targetologView ? (
                <ChartPanel
                  emptyLabel={chartEmpty}
                  title={td('chartUnitsByCategory')}
                  data={monthlyCategories.data}
                  seriesKeys={monthlyCategories.keys}
                  xKey="monthLabel"
                  chartType="bar"
                  onLegendClick={handleLegendCategory}
                  activeCross={crossFilter.category}
                />
              ) : null}
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">{td('weekdayAverages')}</h2>
            <p className="dash-section-hint">{td('weekdayHint')}</p>
            <div className="dash-charts-row">
              {!targetologView ? (
                <ChartPanel
                  emptyLabel={chartEmpty}
                  title={td('chartAvgByCategory')}
                  data={weekdayCategories.data}
                  seriesKeys={weekdayCategories.keys}
                  xKey="weekday_label"
                  chartType="weekday"
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
            <MarketingCharts
              data={mgmtData}
              marketingGranularity={marketingGranularity}
              setMarketingGranularity={setMarketingGranularity}
            />
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
