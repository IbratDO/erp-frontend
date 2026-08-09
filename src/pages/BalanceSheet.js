import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import FilterPanel from '../components/FilterPanel';
import { formatAppNumber } from '../utils/localeFormat';
import './TablePage.css';

function fmtUsd(n, formatAppNumberFn) {
  const v = parseFloat(n) || 0;
  return `$${formatAppNumberFn(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SectionHeader({ number, title }) {
  return (
    <tr className="balance-sheet-section-header">
      <td colSpan={2}>
        {number}. {title}
      </td>
    </tr>
  );
}

function LineRow({ label, value, indent = 0 }) {
  return (
    <tr className="balance-sheet-line">
      <td style={{ paddingLeft: 20 + indent * 16 }}>{label}</td>
      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{value}</td>
    </tr>
  );
}

function TotalRow({ label, value }) {
  return (
    <tr className="balance-sheet-total-row">
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{value}</td>
    </tr>
  );
}

const BalanceSheet = () => {
  const { t, monthOptions } = useAppTranslation(['balanceSheet', 'common']);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    as_of: '',
    year: '',
    month: '',
  });

  const formatUsd = useCallback((n) => fmtUsd(n, formatAppNumber), []);

  const fetchBalanceSheet = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.as_of) {
        params.append('as_of', filter.as_of);
      } else if (filter.year && filter.month) {
        params.append('year', filter.year);
        params.append('month', filter.month);
      } else if (filter.year) {
        params.append('year', filter.year);
      }
      const url = params.toString() ? `/finance/balance_sheet/?${params}` : '/finance/balance_sheet/';
      const { data: res } = await api.get(url);
      setData(res);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalanceSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.as_of, filter.year, filter.month]);

  const assets = data?.assets;
  const liabilities = data?.liabilities;
  const equity = data?.equity;
  const eqn = data?.equation;

  const cashBlock = assets?.current?.cash;
  const cashUsd = parseFloat(cashBlock?.cash_usd) || 0;
  const bankUsd = parseFloat(cashBlock?.bank_usd) || 0;

  const customerRecv =
    assets?.current?.customer_receivables?.total_usd
    ?? assets?.current?.accounts_receivable?.total_usd
    ?? 0;
  const productRecv =
    assets?.current?.product_receivables?.total_usd
    ?? assets?.current?.supplier_advances_usd
    ?? 0;
  // Ordered, not paid for, not yet in inventory — the debit matching the supplier payable
  // an order books at creation. Absent on responses from an older backend, hence the ?? 0.
  const unpaidOrderRecv = assets?.current?.unpaid_order_receivables?.total_usd ?? 0;
  const fixedAssetRecv = assets?.current?.fixed_asset_receivables?.total_usd ?? 0;

  const inv = assets?.current?.inventory;
  const invTotal = parseFloat(inv?.total_usd) || 0;
  const packageUsd = parseFloat(inv?.package_value_usd) || 0;
  const productInvUsd = Math.max(invTotal - packageUsd, 0);
  // Declined delivery items the courier still holds, and the margin on goods already sold but
  // not yet paid for. Both absent on responses from an older backend, hence the ?? 0.
  const goodsWithCourier = assets?.current?.goods_with_courier?.total_usd ?? 0;
  const expectedProfit = equity?.expected_profit_usd ?? 0;

  const faNonCurrent =
    assets?.non_current?.fixed_assets_usd
    ?? assets?.fixed_assets?.non_current_usd
    ?? assets?.non_current?.fixed_assets?.total_usd
    ?? 0;

  const payableExpenses =
    liabilities?.current?.payable_expenses?.total_usd
    ?? liabilities?.current?.accounts_payable?.total_usd
    ?? 0;
  const customerAdvances = liabilities?.current?.customer_advances?.total_usd ?? 0;

  const prepaid = parseFloat(assets?.current?.prepaid_expenses_usd) || 0;

  const totalLiabEquity =
    (parseFloat(liabilities?.total_usd) || 0) + (parseFloat(equity?.total_equity_usd) || 0);

  const packageLabel = inv?.package_units
    ? t('assets.packagesWithUnits', { units: inv.package_units })
    : t('assets.packages');

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="balanceSheet" />
      </div>

      <p style={{ color: '#666', marginBottom: 12, fontSize: '0.9em', maxWidth: 720 }}>
        {t('intro')}
      </p>

      <FilterPanel title={t('filters.title')} filters={filter} style={{ marginBottom: 16 }}>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('filters.asOf')}</label>
            <input
              type="date"
              value={filter.as_of}
              onChange={(e) =>
                setFilter({ as_of: e.target.value, year: '', month: '' })
              }
            />
          </div>
          <div className="filter-field">
            <label>{t('filters.year')}</label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: e.target.value, as_of: '' })}
            >
              <option value="">{t('filters.emptyOption')}</option>
              {Array.from({ length: 10 }, (_, i) => {
                const y = new Date().getFullYear() - i;
                return (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.month')}</label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value, as_of: '' })}
            >
              <option value="">{t('filters.emptyOption')}</option>
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {data?.as_of && (
          <p style={{ margin: '8px 0 0', fontSize: '0.85em', color: '#888' }}>
            {t('positionAsOf', { date: data.as_of })}
            {data.period?.label ? t('plPeriod', { label: data.period.label }) : ''}
          </p>
        )}
      </FilterPanel>

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>{t('loading')}</p>
      ) : !data ? (
        <p style={{ textAlign: 'center', padding: 40 }}>{t('loadFailed')}</p>
      ) : (
        <>
          {eqn && !eqn.balanced && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                background: '#fff3e0',
                border: '1px solid #ff9800',
                borderRadius: 6,
              }}
            >
              {t('balanceCheck.unbalanced', { diff: formatUsd(Math.abs(eqn.difference_usd)) })}
            </div>
          )}

          {eqn?.balanced && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                background: '#e8f5e9',
                border: '1px solid #4caf50',
                borderRadius: 6,
              }}
            >
              {t('balanceCheck.balanced', { total: formatUsd(eqn.total_assets_usd) })}
            </div>
          )}

          <div className="metrics-grid metrics-grid--balance-sheet-summary">
            <div className="metric-card" style={{ border: '2px solid #007bff' }}>
              <div className="metric-label">{t('metrics.totalAssets')}</div>
              <div className="metric-value" style={{ color: '#007bff', fontSize: '1.4em' }}>
                {formatUsd(assets?.total_usd)}
              </div>
            </div>
            <div className="metric-card" style={{ border: '2px solid #6f42c1' }}>
              <div className="metric-label">{t('metrics.equityLiabilities')}</div>
              <div className="metric-value" style={{ color: '#6f42c1', fontSize: '1.4em' }}>
                {formatUsd(totalLiabEquity)}
              </div>
            </div>
          </div>

          <div className="balance-sheet-layout">
            <div className="balance-sheet-panel balance-sheet-panel--assets">
              <div className="table-card balance-sheet-card balance-sheet-card--fill">
                <h3 style={{ borderBottom: '3px solid #007bff', paddingBottom: 8, marginTop: 0 }}>
                  {t('assets.title')}
                </h3>
                <table className="data-table balance-sheet-table">
                  <tbody>
                    <SectionHeader number={1} title={t('assets.sections.money')} />
                    <LineRow label={t('assets.cash')} value={formatUsd(cashUsd)} indent={1} />
                    <LineRow label={t('assets.bank')} value={formatUsd(bankUsd)} indent={1} />

                    <SectionHeader number={2} title={t('assets.sections.receivables')} />
                    <LineRow
                      label={t('assets.customerReceivables')}
                      value={formatUsd(customerRecv)}
                      indent={1}
                    />
                    <LineRow
                      label={t('assets.productReceivables')}
                      value={formatUsd(productRecv)}
                      indent={1}
                    />
                    <LineRow
                      label={t('assets.unpaidOrderReceivables')}
                      value={formatUsd(unpaidOrderRecv)}
                      indent={1}
                    />
                    <LineRow
                      label={t('assets.fixedAssetReceivables')}
                      value={formatUsd(fixedAssetRecv)}
                      indent={1}
                    />

                    <SectionHeader number={3} title={t('assets.sections.inventory')} />
                    <LineRow label={t('assets.products')} value={formatUsd(productInvUsd)} indent={1} />
                    <LineRow label={packageLabel} value={formatUsd(packageUsd)} indent={1} />
                    {goodsWithCourier > 0.005 && (
                      <LineRow
                        label={t('assets.goodsWithCourier')}
                        value={formatUsd(goodsWithCourier)}
                        indent={1}
                      />
                    )}

                    {prepaid > 0.005 && (
                      <LineRow label={t('assets.prepaidExpenses')} value={formatUsd(prepaid)} indent={1} />
                    )}

                    <SectionHeader number={4} title={t('assets.sections.fixedAssets')} />
                    <LineRow
                      label={t('assets.fixedAssetsOnBooks')}
                      value={formatUsd(faNonCurrent)}
                      indent={1}
                    />

                    <TotalRow label={t('assets.total')} value={formatUsd(assets?.total_usd)} />
                  </tbody>
                </table>
              </div>
            </div>

            <div className="balance-sheet-panel balance-sheet-panel--right">
              <div className="table-card balance-sheet-card">
                <h3 style={{ borderBottom: '3px solid #dc3545', paddingBottom: 8, marginTop: 0 }}>
                  {t('liabilities.title')}
                </h3>
                <table className="data-table balance-sheet-table">
                  <tbody>
                    <SectionHeader number={1} title={t('liabilities.sections.payables')} />
                    <LineRow label={t('liabilities.payableExpenses')} value={formatUsd(payableExpenses)} indent={1} />
                    <LineRow
                      label={t('liabilities.customerAdvances')}
                      value={formatUsd(customerAdvances)}
                      indent={1}
                    />
                    <TotalRow
                      label={t('liabilities.total')}
                      value={formatUsd(liabilities?.total_usd)}
                    />
                  </tbody>
                </table>
              </div>

              <div className="table-card balance-sheet-card balance-sheet-card--fill">
                <h3 style={{ borderBottom: '3px solid #6f42c1', paddingBottom: 8, marginTop: 0 }}>
                  {t('equity.title')}
                </h3>
                <table className="data-table balance-sheet-table">
                  <tbody>
                    <LineRow
                      label={t('equity.ownerCapital')}
                      value={formatUsd(equity?.owner_capital_net_usd)}
                    />
                    <LineRow
                      label={t('equity.retainedEarnings')}
                      value={formatUsd(equity?.retained_earnings_usd)}
                      indent={1}
                    />
                    <LineRow
                      label={t('equity.currentPeriodPl')}
                      value={formatUsd(equity?.current_period_profit_usd)}
                      indent={1}
                    />
                    <LineRow
                      label={t('equity.expectedProfit')}
                      value={formatUsd(expectedProfit)}
                      indent={1}
                    />
                    <LineRow
                      label={t('equity.currencyConversionPl')}
                      value={formatUsd(equity?.currency_conversion_pl_usd)}
                      indent={1}
                    />
                    {/* Sits directly under the realized-FX row because the two read as one
                        idea: that one is currency actually exchanged, this one is currency
                        merely held while the rate moved. */}
                    <LineRow
                      label={t('equity.notionalFx')}
                      value={formatUsd(equity?.notional_fx_usd)}
                      indent={1}
                    />
                    <TotalRow label={t('equity.total')} value={formatUsd(equity?.total_equity_usd)} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {data.notes?.length > 0 && (
            <div className="form-card">
              <h3 style={{ marginTop: 0 }}>{t('notes')}</h3>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#555', fontSize: '0.9em' }}>
                {data.notes.map((n, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BalanceSheet;
