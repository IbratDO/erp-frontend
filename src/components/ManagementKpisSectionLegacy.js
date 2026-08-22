import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_PALETTE } from '../utils/dashboardAnalytics';
import { FOUNDER_LEVEL_ROLES } from '../utils/permissions';
import useAppTranslation from '../hooks/useAppTranslation';

function fmtUsd(n) {
  return `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return 'N/A';
  return `${n.toFixed(1)}%`;
}

function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="mgmt-toggle-group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'mgmt-toggle active' : 'mgmt-toggle'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MgmtCard({ label, value, sub }) {
  return (
    <div className="mgmt-kpi-card">
      <div className="mgmt-kpi-label">{label}</div>
      <div className="mgmt-kpi-value">{value}</div>
      {sub ? <div className="mgmt-kpi-sub">{sub}</div> : null}
    </div>
  );
}

function MgmtChart({ title, children, controls }) {
  return (
    <div className="mgmt-chart-card">
      <div className="mgmt-chart-head">
        <h4>{title}</h4>
        {controls || null}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 13,
};

function productLabel(p) {
  return [p.category_type, p.brand, p.model, p.color].filter(Boolean).join(' · ');
}

export default function ManagementKpisSectionLegacy({ roleCode, availableYears, active, marketingOnly = false }) {
  const { t, monthOptions } = useAppTranslation(['dashboard', 'common']);
  const isTargetologRole = roleCode === 'targetolog';
  const showFull =
    !marketingOnly
    && (FOUNDER_LEVEL_ROLES.includes(roleCode) || roleCode === 'ceo' || roleCode === 'investor');
  const show = showFull || (marketingOnly && isTargetologRole);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [turnoverLoading, setTurnoverLoading] = useState(false);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('');
  const [expensesGranularity, setExpensesGranularity] = useState('monthly');
  const [marketingGranularity, setMarketingGranularity] = useState('weekly');

  const load = useCallback(async () => {
    if (!show || !active) return;
    setLoading(true);
    setError(null);
    const params = {
      year,
      month: month || undefined,
      expenses_granularity: expensesGranularity,
      marketing_sold_granularity: marketingGranularity,
      include_turnover: false,
    };
    try {
      const res = await api.get('/dashboard/management-kpis/', { params });
      setData(res.data);
      setLoading(false);

      if (marketingOnly) {
        setTurnoverLoading(false);
        return;
      }

      setTurnoverLoading(true);
      api
        .get('/dashboard/management-kpis/', { params: { ...params, turnover_only: true } })
        .then((turnRes) => {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  capital_turnover_monthly: turnRes.data.capital_turnover_monthly,
                  roi_monthly: turnRes.data.roi_monthly,
                  snapshot: turnRes.data.snapshot,
                  turnover_pending: false,
                }
              : turnRes.data,
          );
        })
        .catch((e) => console.error('Turnover KPIs load failed', e))
        .finally(() => setTurnoverLoading(false));
    } catch (e) {
      console.error(e);
      setError(t('mgmt.loadError'));
      setLoading(false);
      setTurnoverLoading(false);
    }
  }, [year, month, expensesGranularity, marketingGranularity, show, active, marketingOnly, t]);

  useEffect(() => {
    if (show && active) load();
    else setLoading(false);
  }, [load, show, active]);

  const managerSeries = data?.manager_margin_monthly;
  const managerChartData = useMemo(() => {
    const managerKeys = managerSeries?.months || [];
    if (!managerSeries?.series?.length || !managerKeys.length) return [];
    return managerKeys.map((ml, idx) => {
      const row = { monthLabel: ml };
      managerSeries.series.forEach((s) => {
        row[s.manager] = s[ml] ?? 0;
      });
      return row;
    });
  }, [managerSeries]);

  const managerNames = managerSeries?.series?.map((s) => s.manager) || [];

  const snapshot = data?.snapshot;

  if (!show || !active) return null;

  if (loading && !data) {
    return (
      <section className="mgmt-section">
        <p className="mgmt-loading">{t('mgmt.loading')}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mgmt-section">
        <p className="mgmt-error">{error}</p>
      </section>
    );
  }

  const filterBar = (
    <div className="mgmt-section-header">
      <div className="mgmt-filters">
        <label>
          {t('filters.year', { ns: 'common' })}
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
            {(availableYears || [year]).map((y) => (
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
      </div>
    </div>
  );

  if (marketingOnly) {
    return (
      <section className="mgmt-section">
        <h2 className="dash-section-title">{t('mgmt.marketingKpisTitle')}</h2>
        {filterBar}
        <div className="mgmt-charts-grid">
          <MgmtChart
            title={t('mgmt.marketingPerItem')}
            controls={
              <ToggleGroup
                value={marketingGranularity}
                onChange={setMarketingGranularity}
                options={[
                  { value: 'weekly', label: t('mgmt.weekly') },
                  { value: 'monthly', label: t('mgmt.monthly') },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data?.marketing_per_sold_item?.points || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload;
                    return (
                      <div style={tooltipStyle} className="mgmt-tooltip">
                        <div><strong>{label}</strong></div>
                        <div>{t('mgmt.marketing')} {fmtUsd(p?.marketing_expenses_usd)}</div>
                        <div>{t('mgmt.soldUnits')} {p?.sold_units}</div>
                        <div>
                          {t('mgmt.perItem')}{' '}
                          {p?.value_na ? 'N/A' : fmtUsd(p?.value)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" name={t('mgmt.usdPerUnit')} fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </MgmtChart>

          <MgmtChart title={t('mgmt.marketingPerCustomer')}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data?.marketing_per_new_customer_weekly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload;
                    return (
                      <div style={tooltipStyle}>
                        <div><strong>{label}</strong></div>
                        <div>{t('mgmt.marketing')} {fmtUsd(p?.marketing_expenses_usd)}</div>
                        <div>{t('mgmt.newCustomers')} {p?.new_customers}</div>
                        <div>
                          {t('mgmt.perCustomer')} {p?.value_na ? 'N/A' : fmtUsd(p?.value)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" name={t('mgmt.usdPerCustomer')} fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </MgmtChart>
        </div>
      </section>
    );
  }

  return (
    <section className="mgmt-section">
      {filterBar}

      <div className="mgmt-cards-row">
        <MgmtCard
          label={t('mgmt.totalUsdBalance')}
          value={fmtUsd(data?.money_balance?.total_usd)}
          sub={t('mgmt.sameAsMoneyBalance')}
        />
        <MgmtCard
          label={t('mgmt.totalUzsBalance')}
          value={(data?.money_balance?.total_uzs ?? 0).toLocaleString()}
          sub={t('mgmt.nativeUzsTotal')}
        />
        <MgmtCard
          label={t('mgmt.paidNotReceived')}
          value={(data?.paid_not_received_units ?? 0).toLocaleString()}
          sub={t('mgmt.paidNotReceivedSub')}
        />
        <MgmtCard
          label={t('mgmt.capitalTurnover')}
          value={
            turnoverLoading || data?.turnover_pending
              ? '…'
              : snapshot?.capital_turnover?.value_na
                ? 'N/A'
                : (snapshot?.capital_turnover?.value ?? 0).toFixed(2)
          }
          sub={
            turnoverLoading || data?.turnover_pending
              ? t('mgmt.loadingAssets')
              : snapshot?.capital_turnover?.month_label || t('mgmt.latestMonth')
          }
        />
        <MgmtCard
          label={t('mgmt.roi')}
          value={
            turnoverLoading || data?.turnover_pending
              ? '…'
              : snapshot?.roi?.value_na
                ? 'N/A'
                : fmtPct(snapshot?.roi?.value)
          }
          sub={
            turnoverLoading || data?.turnover_pending
              ? t('mgmt.loadingAssets')
              : snapshot?.roi?.month_label || t('mgmt.latestMonth')
          }
        />
      </div>

      <div className="mgmt-grid">
        <MgmtChart title={t('mgmt.netProfitMonthly')}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.net_profit_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtUsd(v)} />
              <Line
                type="monotone"
                dataKey="net_profit_usd"
                name={t('mgmt.netProfit')}
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.managerMargin')}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={managerChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {managerNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart
          title={t('mgmt.otherExpenses')}
          controls={
            <ToggleGroup
              value={expensesGranularity}
              onChange={setExpensesGranularity}
              options={[
                { value: 'daily', label: t('mgmt.daily') },
                { value: 'weekly', label: t('mgmt.weekly') },
                { value: 'monthly', label: t('mgmt.monthly') },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.other_expenses_trend?.points || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div style={tooltipStyle}>
                      <div>
                        <strong>{label}</strong>
                      </div>
                      <div>
                        {t('mgmt.tooltipTotalUsd')} {fmtUsd(p?.total_usd)}
                      </div>
                      {(p?.usd_native ?? 0) > 0 && (
                        <div>
                          {t('mgmt.tooltipUsdExpenses')} {fmtUsd(p.usd_native)}
                        </div>
                      )}
                      {(p?.uzs_native ?? 0) > 0 && (
                        <div>
                          {t('mgmt.tooltipUzsExpenses')} {p.uzs_native.toLocaleString()} UZS
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="total_usd"
                name={t('mgmt.totalUsd')}
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.shopVsDelivery')}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.shop_vs_delivery_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="shop" name={t('mgmt.shop')} stackId="a" fill="#0ea5e9" />
              <Bar dataKey="delivery" name={t('mgmt.delivery')} stackId="a" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.returnsMonthly')}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.returns_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="units" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis
                yAxisId="usd"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) =>
                  name === t('mgmt.refundsUsd') ? fmtUsd(value) : value
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="units"
                dataKey="returned_units"
                name={t('mgmt.returnedUnits')}
                fill="#f59e0b"
              />
              <Bar
                yAxisId="usd"
                dataKey="refunds_usd"
                name={t('mgmt.refundsUsd')}
                fill="#dc2626"
              />
            </BarChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.slowInventory')}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.inventory_aging_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="age_3_5" name={t('mgmt.age3_5')} stackId="age" fill="#f59e0b" />
              <Bar dataKey="age_5_8" name={t('mgmt.age5_8')} stackId="age" fill="#ea580c" />
              <Bar dataKey="age_8_plus" name={t('mgmt.age8plus')} stackId="age" fill="#b91c1c" />
            </BarChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart
          title={t('mgmt.marketingPerItem')}
          controls={
            <ToggleGroup
              value={marketingGranularity}
              onChange={setMarketingGranularity}
              options={[
                { value: 'weekly', label: t('mgmt.weekly') },
                { value: 'monthly', label: t('mgmt.monthly') },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.marketing_per_sold_item?.points || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div style={tooltipStyle} className="mgmt-tooltip">
                      <div>
                        <strong>{label}</strong>
                      </div>
                      <div>
                        {t('mgmt.marketing')} {fmtUsd(p?.marketing_expenses_usd)}
                      </div>
                      <div>
                        {t('mgmt.soldUnits')} {p?.sold_units}
                      </div>
                      <div>
                        {t('mgmt.perItem')}{' '}
                        {p?.value_na ? 'N/A' : fmtUsd(p?.value)}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" name={t('mgmt.usdPerUnit')} fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.marketingPerCustomer')}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.marketing_per_new_customer_weekly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div style={tooltipStyle}>
                      <div>
                        <strong>{label}</strong>
                      </div>
                      <div>
                        {t('mgmt.marketing')} {fmtUsd(p?.marketing_expenses_usd)}
                      </div>
                      <div>
                        {t('mgmt.newCustomers')} {p?.new_customers}
                      </div>
                      <div>
                        {t('mgmt.perCustomer')} {p?.value_na ? 'N/A' : fmtUsd(p?.value)}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" name={t('mgmt.usdPerCustomer')} fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.capitalTurnoverMonthly')}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data?.capital_turnover_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="value"
                name={t('mgmt.turnover')}
                stroke="#0891b2"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </MgmtChart>

        <MgmtChart title={t('mgmt.roiMonthly')}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data?.roi_monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month_label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div style={tooltipStyle}>
                      <div>
                        <strong>{label}</strong>
                      </div>
                      <div>
                        {t('mgmt.netProfitTooltip')} {fmtUsd(p?.net_profit_usd)}
                      </div>
                      <div>
                        {t('mgmt.beginningAssets')} {fmtUsd(p?.beginning_assets_usd)}
                      </div>
                      <div>
                        {t('mgmt.roiLabel')} {p?.value_na ? 'N/A' : fmtPct(p?.value)}
                      </div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="value" name={t('mgmt.roiMonthly')} stroke="#7c3aed" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </MgmtChart>

        <div className="mgmt-chart-card mgmt-top-products mgmt-top-products-wide">
          <h4>{t('mgmt.top5Products')}</h4>
          {!(data?.top_products_by_month?.length) ? (
            <p className="mgmt-empty">{t('mgmt.noSalesInPeriod')}</p>
          ) : (
            <div className="mgmt-top-products-grid">
              {data.top_products_by_month.map((block) => (
                <div key={`${block.year}-${block.month}`} className="mgmt-top-products-month">
                  <h5>{block.month_label}</h5>
                  {!block.products?.length ? (
                    <p className="mgmt-empty mgmt-empty-compact">{t('mgmt.noSales')}</p>
                  ) : (
                    <ol className="mgmt-product-list mgmt-product-list-compact">
                      {block.products.map((p, i) => (
                        <li key={`${block.month}-${p.brand}-${p.model}-${i}`}>
                          <span className="mgmt-rank mgmt-rank-compact">{i + 1}</span>
                          <span className="mgmt-product-detail">{productLabel(p)}</span>
                          <span className="mgmt-product-units">{p.units}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
