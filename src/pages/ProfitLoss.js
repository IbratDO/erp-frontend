import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime, formatAppNumber } from '../utils/localeFormat';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import FilterPanel from '../components/FilterPanel';
import { useClientTableSort } from '../utils/tableSort';

const PROFIT_LOSS_SALE_SORT_ACCESSORS = {
  sale_id: (item) => Number(item.sale_id) || 0,
  product: (item) => String(item.product ?? '').toLowerCase(),
  quantity: (item) => Number(item.quantity) || 0,
  completed_at: (item) => {
    const s = item.completed_at;
    if (!s) return 0;
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  },
  income_usd: (item) => Number(item.income_usd) || 0,
  cogs_usd: (item) => Number(item.total_cogs_usd) || 0,
  profit_usd: (item) => Number(item.profit_usd) || 0,
};

const OPERATING_EXPENSE_SORT_ACCESSORS = {
  expense_type_label: (item) => String(item.type ?? '').toLowerCase(),
  amount_usd: (item) => Number(item.amount_usd) || 0,
  date: (item) => {
    const s = item.date;
    if (s == null || s === '') return 0;
    const t = new Date(`${s}T12:00:00`).getTime();
    return Number.isFinite(t) ? t : String(s).toLowerCase();
  },
};

const CONVERSION_DIFF_SORT_ACCESSORS = {
  description: (item) => String(item.description ?? '').toLowerCase(),
  gain_usd: (item) => Number(item.gain_usd) || 0,
  loss_usd: (item) => Number(item.loss_usd) || 0,
  net_usd: (item) => Number(item.net_usd) || 0,
  date: (item) => {
    const s = item.date;
    if (s == null || s === '') return 0;
    const t = new Date(`${s}T12:00:00`).getTime();
    return Number.isFinite(t) ? t : String(s).toLowerCase();
  },
};

const OTHER_INCOME_SORT_ACCESSORS = {
  income_type_label: (item) => String(item.type ?? '').toLowerCase(),
  description: (item) => String(item.description ?? '').toLowerCase(),
  amount_usd: (item) => Number(item.amount_usd) || 0,
  date: (item) => {
    const s = item.date;
    if (s == null || s === '') return 0;
    const t = new Date(`${s}T12:00:00`).getTime();
    return Number.isFinite(t) ? t : String(s).toLowerCase();
  },
};

const ProfitLoss = () => {
  const { t, monthOptions } = useAppTranslation(['profitLoss', 'common']);
  const [profitLoss, setProfitLoss] = useState(null);
  const [expandedPlSaleId, setExpandedPlSaleId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    year: '',
    month: '',
  });

  const fetchProfitLoss = async () => {
    setLoading(true);
    try {
      let url = '/finance/profit_loss/';
      const params = new URLSearchParams();

      if (filter.year || filter.month) {
        if (filter.year && filter.month) {
          params.append('year', filter.year);
          params.append('month', filter.month);
        } else if (filter.year) {
          params.append('year', filter.year);
        } else if (filter.month) {
          const currentYear = new Date().getFullYear();
          params.append('year', currentYear);
          params.append('month', filter.month);
        }
      }

      if (params.toString()) url += `?${params.toString()}`;

      const response = await api.get(url);
      setProfitLoss(response.data);
      setExpandedPlSaleId(null);
    } catch (error) {
      console.error('Error fetching profit/loss:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfitLoss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.year, filter.month]);

  const profitLossSalesSort = useClientTableSort(PROFIT_LOSS_SALE_SORT_ACCESSORS);
  const sortedProfitLossSales = useMemo(
    () => profitLossSalesSort.sortRows(profitLoss?.sales || []),
    [profitLoss?.sales, profitLossSalesSort],
  );

  const operatingExpenseSort = useClientTableSort(OPERATING_EXPENSE_SORT_ACCESSORS);
  const sortedOperatingExpenses = useMemo(
    () => operatingExpenseSort.sortRows(profitLoss?.operating_expenses || []),
    [profitLoss?.operating_expenses, operatingExpenseSort],
  );

  const otherIncomeSort = useClientTableSort(OTHER_INCOME_SORT_ACCESSORS);
  const sortedOtherIncome = useMemo(
    () => otherIncomeSort.sortRows(profitLoss?.other_income || []),
    [profitLoss?.other_income, otherIncomeSort],
  );

  const conversionDiffSort = useClientTableSort(CONVERSION_DIFF_SORT_ACCESSORS);
  const sortedConversionDiffs = useMemo(
    () => conversionDiffSort.sortRows(profitLoss?.conversion_differences || []),
    [profitLoss?.conversion_differences, conversionDiffSort],
  );

  const fmtUsd = useCallback(
    (n) =>
      `$${formatAppNumber(n || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [],
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="profitLoss" />
      </div>

      <FilterPanel title={t('filters.title')} filters={filter} style={{ marginBottom: '16px' }}>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('filters.year')}</label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: e.target.value })}
            >
              <option value="">{t('filters.allYears')}</option>
              {Array.from({ length: 10 }, (_, i) => {
                const year = new Date().getFullYear() - i;
                return (
                  <option key={year} value={year.toString()}>
                    {year}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.month')}</label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            >
              <option value="">{t('filters.allMonths')}</option>
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterPanel>

      <p style={{ color: '#666', marginBottom: '8px', fontSize: '0.9em' }}>
        {t('intro')}
      </p>
      {profitLoss?.exchange_rate?.label && (
        <p style={{ color: '#888', marginBottom: '16px', fontSize: '0.75em' }}>
          {profitLoss.exchange_rate.label}
        </p>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>{t('actions.loading', { ns: 'common' })}</div>
      ) : profitLoss ? (
        <div>
          <div className="metrics-grid" style={{ marginBottom: '20px' }}>
            <div className="metric-card" style={{ border: '2px solid #28a745' }}>
              <div className="metric-label">{t('metrics.netRevenue')}</div>
              <div className="metric-value" style={{ color: '#28a745', fontSize: '1.6em' }}>
                {fmtUsd(profitLoss.totals.total_income_usd)}
              </div>
            </div>
            <div className="metric-card" style={{ border: '2px solid #dc3545' }}>
              <div className="metric-label">{t('metrics.netCogs')}</div>
              <div className="metric-value" style={{ color: '#dc3545', fontSize: '1.6em' }}>
                {fmtUsd(profitLoss.totals.total_cogs_usd)}
              </div>
            </div>
            <div className="metric-card" style={{ border: '2px solid #dc3545' }}>
              <div className="metric-label">{t('metrics.operatingExpenses')}</div>
              <div className="metric-value" style={{ color: '#dc3545', fontSize: '1.6em' }}>
                {fmtUsd(profitLoss.totals.total_operating_expenses_usd)}
              </div>
            </div>
            <div className="metric-card" style={{ border: '2px solid #28a745' }}>
              <div className="metric-label">{t('metrics.otherIncome')}</div>
              <div className="metric-value" style={{ color: '#28a745', fontSize: '1.6em' }}>
                {fmtUsd(profitLoss.totals.total_other_income_usd)}
              </div>
            </div>
            <div
              className="metric-card"
              style={{
                border: `2px solid ${(profitLoss.totals.total_conversion_net_usd || 0) >= 0 ? '#28a745' : '#dc3545'}`,
              }}
            >
              <div className="metric-label">{t('metrics.conversionDiff')}</div>
              <div
                className="metric-value"
                style={{
                  color:
                    (profitLoss.totals.total_conversion_net_usd || 0) >= 0 ? '#28a745' : '#dc3545',
                  fontSize: '1.6em',
                }}
              >
                {fmtUsd(profitLoss.totals.total_conversion_net_usd)}
              </div>
            </div>
            <div
              className="metric-card"
              style={{
                border: `2px solid ${(profitLoss.totals.net_profit_usd || 0) >= 0 ? '#28a745' : '#dc3545'}`,
              }}
            >
              <div className="metric-label">{t('metrics.netProfitLoss')}</div>
              <div
                className="metric-value"
                style={{
                  color: (profitLoss.totals.net_profit_usd || 0) >= 0 ? '#28a745' : '#dc3545',
                  fontSize: '1.6em',
                }}
              >
                {fmtUsd(profitLoss.totals.net_profit_usd)}
              </div>
            </div>
          </div>

          <div className="table-card" style={{ marginBottom: '20px' }}>
            <h3>{t('sales.title')}</h3>
            <p style={{ color: '#888', fontSize: '0.85em', margin: '0 0 8px' }}>
              {t('sales.hint')}
            </p>
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh
                      columnId="sale_id"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.saleId')}
                    </SortableTh>
                    <SortableTh
                      columnId="product"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.product')}
                    </SortableTh>
                    <SortableTh
                      columnId="quantity"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.qty')}
                    </SortableTh>
                    <SortableTh
                      columnId="completed_at"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.completed')}
                    </SortableTh>
                    <SortableTh
                      columnId="income_usd"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.incomeUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="cogs_usd"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.cogsUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="profit_usd"
                      sortCol={profitLossSalesSort.sortCol}
                      sortDir={profitLossSalesSort.sortDir}
                      onSort={profitLossSalesSort.onHeaderClick}
                    >
                      {t('sales.profitUsd')}
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {profitLoss.sales.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center' }}>
                        {t('sales.noRows')}
                      </td>
                    </tr>
                  ) : (
                    sortedProfitLossSales.map((item) => {
                      const expanded = expandedPlSaleId === item.sale_id;
                      const bd = item.cogs_breakdown || {};
                      return (
                        <React.Fragment key={item.sale_id}>
                          <tr
                            onClick={() => setExpandedPlSaleId(expanded ? null : item.sale_id)}
                            style={{ cursor: 'pointer', backgroundColor: expanded ? '#f0f7ff' : undefined }}
                            title={t('sales.rowTitle')}
                          >
                            <td>#{item.sale_id}</td>
                            <td>{item.product}</td>
                            <td>
                              {item.quantity}
                              {item.quantity_returned > 0 && (
                                <span style={{ color: '#888', fontSize: '0.85em' }}>
                                  {' '}
                                  {t('sales.returned', { count: item.quantity_returned })}
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: '0.9em' }}>
                              {item.completed_at ? formatAppDateTime(item.completed_at) : '—'}
                            </td>
                            <td>{fmtUsd(item.income_usd)}</td>
                            <td>{fmtUsd(item.total_cogs_usd)}</td>
                            <td
                              style={{
                                color: item.profit_usd >= 0 ? '#28a745' : '#dc3545',
                                fontWeight: '600',
                              }}
                            >
                              {fmtUsd(item.profit_usd)}
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan="7" style={{ backgroundColor: '#fafafa', padding: '12px 16px' }}>
                                <div style={{ fontSize: '0.9em', lineHeight: 1.7 }}>
                                  <strong>{t('sales.breakdownTitle')}</strong>
                                  <div
                                    style={{
                                      marginTop: '8px',
                                      display: 'grid',
                                      gridTemplateColumns: '1fr auto',
                                      maxWidth: '480px',
                                      gap: '4px 24px',
                                    }}
                                  >
                                    {(item.gross_income_usd || 0) > 0 && (
                                      <>
                                        <span>{t('sales.grossRevenue')}</span>
                                        <span style={{ textAlign: 'right' }}>{fmtUsd(item.gross_income_usd)}</span>
                                      </>
                                    )}
                                    {(item.refunds_usd || 0) > 0 && (
                                      <>
                                        <span style={{ paddingLeft: '12px', color: '#666' }}>
                                          {t('sales.refundsPaid')}
                                        </span>
                                        <span style={{ textAlign: 'right', color: '#dc3545' }}>
                                          {fmtUsd(item.refunds_usd)}
                                        </span>
                                      </>
                                    )}
                                    <span>{t('sales.netRevenue')}</span>
                                    <span style={{ textAlign: 'right' }}>{fmtUsd(item.income_usd)}</span>
                                    {(item.cogs_reversal_usd || 0) > 0 && (
                                      <>
                                        <span style={{ paddingLeft: '12px', color: '#666' }}>
                                          {t('sales.cogsRestored')}
                                        </span>
                                        <span style={{ textAlign: 'right', color: '#28a745' }}>
                                          {fmtUsd(item.cogs_reversal_usd)}
                                        </span>
                                      </>
                                    )}
                                    {(item.other_profit_usd || 0) > 0 && (
                                      <>
                                        <span style={{ paddingLeft: '12px', color: '#5e35b1' }}>
                                          {t('sales.otherProfit')}
                                        </span>
                                        <span style={{ textAlign: 'right', color: '#5e35b1' }}>
                                          {fmtUsd(item.other_profit_usd)}
                                        </span>
                                      </>
                                    )}
                                    {(item.other_loss_usd || 0) > 0 && (
                                      <>
                                        <span style={{ paddingLeft: '12px', color: '#c62828' }}>
                                          {t('sales.otherLoss')}
                                        </span>
                                        <span style={{ textAlign: 'right', color: '#c62828' }}>
                                          {fmtUsd(item.other_loss_usd)}
                                        </span>
                                      </>
                                    )}
                                    <span style={{ paddingLeft: '12px', color: '#666' }}>
                                      {t('sales.purchaseCogs')}
                                    </span>
                                    <span style={{ textAlign: 'right' }}>{fmtUsd(bd.purchase_cogs_usd)}</span>
                                    <span style={{ paddingLeft: '24px', color: '#888', fontSize: '0.92em' }}>
                                      {t('sales.supplier')}
                                    </span>
                                    <span style={{ textAlign: 'right', color: '#888' }}>
                                      {fmtUsd(bd.supplier_cogs_usd)}
                                    </span>
                                    <span style={{ paddingLeft: '24px', color: '#888', fontSize: '0.92em' }}>
                                      {t('sales.allocatedCargo')}
                                    </span>
                                    <span style={{ textAlign: 'right', color: '#888' }}>
                                      {fmtUsd(bd.cargo_cogs_usd)}
                                    </span>
                                    <span style={{ paddingLeft: '12px', color: '#666' }}>{t('sales.packageCogs')}</span>
                                    <span style={{ textAlign: 'right' }}>{fmtUsd(bd.package_cogs_usd)}</span>
                                    <span style={{ paddingLeft: '12px', color: '#666' }}>{t('sales.deliveryCogs')}</span>
                                    <span style={{ textAlign: 'right' }}>{fmtUsd(bd.delivery_cogs_usd)}</span>
                                    <span
                                      style={{
                                        borderTop: '1px solid #ddd',
                                        paddingTop: '6px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {t('sales.netProfitSale')}
                                    </span>
                                    <span
                                      style={{
                                        borderTop: '1px solid #ddd',
                                        paddingTop: '6px',
                                        textAlign: 'right',
                                        fontWeight: 600,
                                        color: item.profit_usd >= 0 ? '#28a745' : '#dc3545',
                                      }}
                                    >
                                      {fmtUsd(item.profit_usd)}
                                    </span>
                                  </div>
                                  <p style={{ margin: '10px 0 0', color: '#888', fontSize: '0.82em' }}>
                                    {t('sales.opexNote')}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 'bold', backgroundColor: '#f5f5f5' }}>
                    <td colSpan="4">{t('sales.totals')}</td>
                    <td>{fmtUsd(profitLoss.totals.total_income_usd)}</td>
                    <td>{fmtUsd(profitLoss.totals.total_cogs_usd)}</td>
                    <td style={{ color: profitLoss.totals.net_profit_usd >= 0 ? '#28a745' : '#dc3545' }}>
                      {fmtUsd(profitLoss.totals.net_profit_usd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="table-card">
            <h3>{t('operating.title')}</h3>
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh
                      columnId="expense_type_label"
                      sortCol={operatingExpenseSort.sortCol}
                      sortDir={operatingExpenseSort.sortDir}
                      onSort={operatingExpenseSort.onHeaderClick}
                    >
                      {t('operating.type')}
                    </SortableTh>
                    <SortableTh
                      columnId="amount_usd"
                      sortCol={operatingExpenseSort.sortCol}
                      sortDir={operatingExpenseSort.sortDir}
                      onSort={operatingExpenseSort.onHeaderClick}
                    >
                      {t('operating.amountUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="date"
                      sortCol={operatingExpenseSort.sortCol}
                      sortDir={operatingExpenseSort.sortDir}
                      onSort={operatingExpenseSort.onHeaderClick}
                    >
                      {t('operating.date')}
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {profitLoss.operating_expenses.length === 0 ? (
                    <tr>
                      <td colSpan="3" style={{ textAlign: 'center' }}>
                        {t('operating.noRows')}
                      </td>
                    </tr>
                  ) : (
                    sortedOperatingExpenses.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.type}</td>
                        <td>{fmtUsd(item.amount_usd)}</td>
                        <td>{item.date}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 'bold', backgroundColor: '#f5f5f5' }}>
                    <td>{t('operating.totalOperating')}</td>
                    <td>{fmtUsd(profitLoss.totals.total_operating_expenses_usd)}</td>
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="table-card" style={{ marginTop: '20px' }}>
            <h3>{t('otherIncome.title')}</h3>
            <p style={{ color: '#666', fontSize: '0.85em', marginTop: 0 }}>
              {t('otherIncome.hint')}
            </p>
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh
                      columnId="income_type_label"
                      sortCol={otherIncomeSort.sortCol}
                      sortDir={otherIncomeSort.sortDir}
                      onSort={otherIncomeSort.onHeaderClick}
                    >
                      {t('otherIncome.type')}
                    </SortableTh>
                    <SortableTh
                      columnId="description"
                      sortCol={otherIncomeSort.sortCol}
                      sortDir={otherIncomeSort.sortDir}
                      onSort={otherIncomeSort.onHeaderClick}
                    >
                      {t('otherIncome.description')}
                    </SortableTh>
                    <SortableTh
                      columnId="amount_usd"
                      sortCol={otherIncomeSort.sortCol}
                      sortDir={otherIncomeSort.sortDir}
                      onSort={otherIncomeSort.onHeaderClick}
                    >
                      {t('otherIncome.amountUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="date"
                      sortCol={otherIncomeSort.sortCol}
                      sortDir={otherIncomeSort.sortDir}
                      onSort={otherIncomeSort.onHeaderClick}
                    >
                      {t('otherIncome.date')}
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedOtherIncome.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center' }}>
                        {t('otherIncome.noRows')}
                      </td>
                    </tr>
                  ) : (
                    sortedOtherIncome.map((item, idx) => (
                      <tr key={item.id ?? idx}>
                        <td>{item.type}</td>
                        <td>{item.description}</td>
                        <td>{fmtUsd(item.amount_usd)}</td>
                        <td>{item.date}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 'bold', backgroundColor: '#f5f5f5' }}>
                    <td colSpan="2">{t('otherIncome.total')}</td>
                    <td>{fmtUsd(profitLoss.totals.total_other_income_usd)}</td>
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="table-card" style={{ marginTop: '20px' }}>
            <h3>{t('conversionDiff.title')}</h3>
            <p style={{ color: '#666', fontSize: '0.85em', marginTop: 0 }}>
              {t('conversionDiff.hint')}
            </p>
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh
                      columnId="description"
                      sortCol={conversionDiffSort.sortCol}
                      sortDir={conversionDiffSort.sortDir}
                      onSort={conversionDiffSort.onHeaderClick}
                    >
                      {t('conversionDiff.description')}
                    </SortableTh>
                    <SortableTh
                      columnId="gain_usd"
                      sortCol={conversionDiffSort.sortCol}
                      sortDir={conversionDiffSort.sortDir}
                      onSort={conversionDiffSort.onHeaderClick}
                    >
                      {t('conversionDiff.gainUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="loss_usd"
                      sortCol={conversionDiffSort.sortCol}
                      sortDir={conversionDiffSort.sortDir}
                      onSort={conversionDiffSort.onHeaderClick}
                    >
                      {t('conversionDiff.lossUsd')}
                    </SortableTh>
                    <SortableTh
                      columnId="date"
                      sortCol={conversionDiffSort.sortCol}
                      sortDir={conversionDiffSort.sortDir}
                      onSort={conversionDiffSort.onHeaderClick}
                    >
                      {t('conversionDiff.date')}
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedConversionDiffs.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center' }}>
                        {t('conversionDiff.noRows')}
                      </td>
                    </tr>
                  ) : (
                    sortedConversionDiffs.map((item, idx) => (
                      <tr key={item.id ?? idx}>
                        <td>{item.description}</td>
                        <td style={{ color: item.gain_usd > 0 ? '#2e7d32' : undefined }}>
                          {item.gain_usd > 0 ? fmtUsd(item.gain_usd) : '—'}
                        </td>
                        <td style={{ color: item.loss_usd > 0 ? '#c62828' : undefined }}>
                          {item.loss_usd > 0 ? fmtUsd(item.loss_usd) : '—'}
                        </td>
                        <td>{item.date}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 'bold', backgroundColor: '#f5f5f5' }}>
                    <td>{t('conversionDiff.total')}</td>
                    <td>{fmtUsd(profitLoss.totals.total_conversion_gain_usd)}</td>
                    <td>{fmtUsd(profitLoss.totals.total_conversion_loss_usd)}</td>
                    <td>—</td>
                  </tr>
                  <tr style={{ fontWeight: 'bold' }}>
                    <td>{t('conversionDiff.net')}</td>
                    <td
                      colSpan="3"
                      style={{
                        color:
                          (profitLoss.totals.total_conversion_net_usd || 0) < 0
                            ? '#c62828'
                            : '#2e7d32',
                      }}
                    >
                      {fmtUsd(profitLoss.totals.total_conversion_net_usd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px' }}>{t('noData')}</div>
      )}
    </div>
  );
};

export default ProfitLoss;
