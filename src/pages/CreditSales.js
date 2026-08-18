import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import AmountInput from '../components/AmountInput';
import FilterPanel from '../components/FilterPanel';
import PageTitle from '../components/PageTitle';
import SortableTh from '../components/SortableTh';
import useAppTranslation from '../hooks/useAppTranslation';
import { usePermissions } from '../hooks/usePermissions';
import { formatDisplayAmount } from '../utils/currencyFormat';
import { dateOnlyToLocalDate, formatAppDate, formatAppDateTime } from '../utils/localeFormat';
import { useClientTableSort } from '../utils/tableSort';
import './TablePage.css';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';

/**
 * Nasiya savdo — goods that left the shop against a promise.
 *
 * The money itself is not here. Every open debt has a `Receivable` behind it, and that is what
 * the balance sheet reads, so collection posts to the receivable and this page records the
 * result as history. One place that moves cash means the debt and the sheet cannot drift apart.
 */

/**
 * How near the due date is, as a colour.
 *
 * Deliberately a pure function of the row so the same scale can be reused on Receivables. The
 * bands come from the spec: settled is green, comfortably ahead is plain, the last ten days
 * are amber, and past due is red. Ten days is the shop's own working horizon for chasing.
 */
export function creditRowBackground(row) {
  if (!row) return undefined;
  if (row.status === 'paid') return '#d4edda';
  if (row.status === 'waived') return '#e2e3e5';
  const days = row.days_until_due;
  if (days == null) return undefined;
  if (days < 0) return '#f8d7da';
  if (days <= 10) return '#fff3cd';
  return undefined;
}

const num = (v) => parseFloat(v) || 0;

/** Module-level so the hook's memo keys stay stable across renders. */
const SORT_ACCESSORS = {
  id: (r) => r.id,
  customer: (r) => r.customer_name || '',
  status: (r) => r.status,
  principal: (r) => num(r.principal_amount),
  paid: (r) => num(r.paid_amount),
  remaining: (r) => num(r.remaining_amount),
  due: (r) => r.due_date || '',
};

export default function CreditSales() {
  const { t } = useAppTranslation(['creditSales', 'common']);
  const { hasPermission } = usePermissions();
  const canCollect = hasPermission('credit_sales.collect');
  const canWaive = hasPermission('credit_sales.waive');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ scope: 'open', status: '', search: '' });

  const [expandedId, setExpandedId] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [collectTarget, setCollectTarget] = useState(null);
  const [collectForm, setCollectForm] = useState({ amount: '', notes: '' });
  const [waiveTarget, setWaiveTarget] = useState(null);
  const [waiveReason, setWaiveReason] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // `status` and `scope` are alternatives on the server: naming a status overrides the
      // open/all split, so only one is ever sent.
      if (filter.status) params.set('status', filter.status);
      else params.set('scope', filter.scope);
      const res = await apiGetAll(`/credit-sales/?${params.toString()}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error('Error fetching credit sales:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter.scope, filter.status]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const visibleRows = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const p = r.sale_detail?.product_detail;
      return [
        r.customer_name,
        p ? `${p.brand || ''} ${p.model || ''}` : '',
        String(r.sale),
        String(r.id),
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [rows, filter.search]);

  const tableSort = useClientTableSort(SORT_ACCESSORS);
  const sorted = useMemo(() => tableSort.sortRows(visibleRows), [tableSort, visibleRows]);

  // Debts in different currencies do not add up to one number, so they are never summed into
  // one. Each currency keeps its own total, which is also how the customer is owed it.
  const totalsByCurrency = useMemo(() => {
    const acc = {};
    for (const r of visibleRows) {
      const ccy = (r.currency || 'USD').toUpperCase();
      acc[ccy] = acc[ccy] || { principal: 0, paid: 0, remaining: 0 };
      acc[ccy].principal += num(r.principal_amount);
      acc[ccy].paid += num(r.paid_amount);
      acc[ccy].remaining += num(r.remaining_amount);
    }
    return acc;
  }, [visibleRows]);

  const toggleHistory = async (row) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      setHistory(null);
      return;
    }
    setExpandedId(row.id);
    setHistory(null);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/credit-sales/${row.id}/payment_history/`);
      setHistory(res.data);
    } catch (error) {
      console.error('Error fetching payment history:', error);
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const beginCollect = (row) => {
    setWaiveTarget(null);
    setCollectTarget(row);
    const ccy = (row.currency || 'USD').toUpperCase();
    const rem = num(row.remaining_amount);
    setCollectForm({
      // Prefilled with the whole remaining debt, which is what most instalments are. It is only
      // a default — the box is the point of the panel.
      amount: rem > 0 ? (ccy === 'UZS' ? String(Math.round(rem)) : rem.toFixed(2)) : '',
      notes: '',
    });
  };

  const apiErrorText = (error) => {
    const d = error.response?.data;
    return d?.error || d?.detail || t('errors.generic');
  };

  const handleCollectSubmit = async (e) => {
    e.preventDefault();
    if (!collectTarget) return;
    const ccy = (collectTarget.currency || 'USD').toUpperCase();
    const pay = num(collectForm.amount);
    const rem = num(collectTarget.remaining_amount);
    if (pay <= 0) {
      alert(t('errors.amountRequired'));
      return;
    }
    // The tolerance matches the receivables page: a cent of rounding is not an overpayment.
    if (pay > rem + 0.02) {
      alert(t('errors.amountExceeds', { balance: formatDisplayAmount(rem, ccy) }));
      return;
    }
    try {
      const res = await api.post(`/credit-sales/${collectTarget.id}/collect_payment/`, {
        uzs_cash: ccy === 'UZS' ? pay : 0,
        uzs_card: 0,
        usd_cash: ccy === 'USD' ? pay : 0,
        usd_card: 0,
        notes: String(collectForm.notes || '').trim(),
      });
      alert(res.data?.message || t('collect.recorded'));
      setCollectTarget(null);
      setCollectForm({ amount: '', notes: '' });
      setExpandedId(null);
      setHistory(null);
      await fetchRows();
    } catch (error) {
      console.error('Error collecting credit sale payment:', error);
      alert(apiErrorText(error));
    }
  };

  const handleWaiveSubmit = async (e) => {
    e.preventDefault();
    if (!waiveTarget) return;
    const reason = waiveReason.trim();
    if (!reason) {
      alert(t('errors.reasonRequired'));
      return;
    }
    const ccy = (waiveTarget.currency || 'USD').toUpperCase();
    if (
      !window.confirm(
        t('waive.confirm', {
          amount: formatDisplayAmount(num(waiveTarget.remaining_amount), ccy),
          customer: waiveTarget.customer_name || '—',
        }),
      )
    ) {
      return;
    }
    try {
      const res = await api.post(`/credit-sales/${waiveTarget.id}/waive/`, { reason });
      alert(res.data?.message || t('waive.done'));
      setWaiveTarget(null);
      setWaiveReason('');
      await fetchRows();
    } catch (error) {
      console.error('Error waiving credit sale:', error);
      alert(apiErrorText(error));
    }
  };

  const productLabel = (row) => {
    const p = row.sale_detail?.product_detail;
    if (!p) return '—';
    return [p.brand, p.model, p.size].filter(Boolean).join(' ');
  };

  const dueLabel = (row) => {
    if (!row.due_date) return '—';
    const days = row.days_until_due;
    const date = formatAppDate(dateOnlyToLocalDate(row.due_date));
    if (row.status === 'paid' || row.status === 'waived' || days == null) return date;
    if (days < 0) return `${date} · ${t('due.overdueBy', { days: Math.abs(days) })}`;
    return `${date} · ${t('due.inDays', { days })}`;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="creditSales" />
      </div>
      <p style={{ color: '#666', margin: '0 0 16px', fontSize: '0.92rem' }}>{t('intro')}</p>

      <FilterPanel title={t('filters.title')} filters={filter}>
                  <div className="filter-field">
            <label>{t('filters.scope')}</label>
            <select
              value={filter.scope}
              onChange={(e) => setFilter({ ...filter, scope: e.target.value, status: '' })}
            >
              <option value="open">{t('filters.scopeOpen')}</option>
              <option value="all">{t('filters.scopeAll')}</option>
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.status')}</label>
            <select
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">{t('filters.statusAny')}</option>
              <option value="unpaid">{t('status.unpaid')}</option>
              <option value="partial">{t('status.partial')}</option>
              <option value="paid">{t('status.paid')}</option>
              <option value="waived">{t('status.waived')}</option>
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.search')}</label>
            <input
              type="text"
              value={filter.search}
              placeholder={t('filters.searchPlaceholder')}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            />
          </div>
      </FilterPanel>

      {collectTarget && canCollect && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>{t('collect.title', { id: collectTarget.id })}</h2>
          <p style={{ color: '#666', marginBottom: 12, fontSize: '0.92rem' }}>
            {t('collect.hint', {
              customer: collectTarget.customer_name || '—',
              amount: formatDisplayAmount(
                num(collectTarget.remaining_amount),
                (collectTarget.currency || 'USD').toUpperCase(),
              ),
            })}
          </p>
          <BusyForm onSubmit={handleCollectSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>
                  {t('collect.amount', { currency: (collectTarget.currency || 'USD').toUpperCase() })}
                </label>
                <AmountInput
                  placeholder="0"
                  value={collectForm.amount}
                  onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('collect.notes')}</label>
                <textarea
                  rows={2}
                  value={collectForm.notes}
                  onChange={(e) => setCollectForm({ ...collectForm, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">{t('collect.record')}</SubmitButton>
              <button type="button" className="btn-edit" onClick={() => setCollectTarget(null)}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
        </div>
      )}

      {waiveTarget && canWaive && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>{t('waive.title', { id: waiveTarget.id })}</h2>
          <p style={{ color: '#b45309', marginBottom: 12, fontSize: '0.92rem' }}>
            {t('waive.hint', {
              amount: formatDisplayAmount(
                num(waiveTarget.remaining_amount),
                (waiveTarget.currency || 'USD').toUpperCase(),
              ),
            })}
          </p>
          <BusyForm onSubmit={handleWaiveSubmit}>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('waive.reason')}</label>
                <textarea
                  rows={3}
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  required
                />
                <small style={{ color: '#666', display: 'block', marginTop: 5 }}>
                  {t('waive.reasonHint')}
                </small>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-danger-action">{t('waive.record')}</SubmitButton>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setWaiveTarget(null);
                  setWaiveReason('');
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
        </div>
      )}

      <div className="table-card">
        <h2>{t('table.title')}</h2>
        {Object.keys(totalsByCurrency).length > 0 && (
          <p style={{ color: '#444', fontSize: '0.9em', margin: '0 0 10px' }}>
            {Object.entries(totalsByCurrency).map(([ccy, sums]) => (
              <span key={ccy} style={{ marginRight: 18 }}>
                <strong>{ccy}</strong>{' '}
                {t('table.totalsLine', {
                  principal: formatDisplayAmount(sums.principal, ccy),
                  paid: formatDisplayAmount(sums.paid, ccy),
                  remaining: formatDisplayAmount(sums.remaining, ccy),
                })}
              </span>
            ))}
          </p>
        )}
        {loading ? (
          <p>{t('actions.loading', { ns: 'common' })}</p>
        ) : sorted.length === 0 ? (
          <p>{t('table.empty')}</p>
        ) : (
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTh columnId="id" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.id')}
                  </SortableTh>
                  <th>{t('table.sale')}</th>
                  <SortableTh columnId="customer" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.customer')}
                  </SortableTh>
                  <th>{t('table.product')}</th>
                  <SortableTh columnId="status" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.status')}
                  </SortableTh>
                  <SortableTh columnId="principal" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.principal')}
                  </SortableTh>
                  <SortableTh columnId="paid" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.paid')}
                  </SortableTh>
                  <SortableTh columnId="remaining" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.remaining')}
                  </SortableTh>
                  <SortableTh columnId="due" sortCol={tableSort.sortCol} sortDir={tableSort.sortDir} onSort={tableSort.onHeaderClick}>
                    {t('table.due')}
                  </SortableTh>
                  <th>{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const ccy = (row.currency || 'USD').toUpperCase();
                  const isOpen = row.status === 'unpaid' || row.status === 'partial';
                  return (
                    <React.Fragment key={row.id}>
                      <tr style={{ backgroundColor: creditRowBackground(row) }}>
                        <td>#{row.id}</td>
                        <td>#{row.sale}</td>
                        <td>{row.customer_name || '—'}</td>
                        <td>{productLabel(row)}</td>
                        <td>{t(`status.${row.status}`)}</td>
                        <td>{formatDisplayAmount(num(row.principal_amount), ccy)}</td>
                        <td>{formatDisplayAmount(num(row.paid_amount), ccy)}</td>
                        <td>
                          <strong>{formatDisplayAmount(num(row.remaining_amount), ccy)}</strong>
                        </td>
                        <td>{dueLabel(row)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-edit"
                              onClick={() => toggleHistory(row)}
                            >
                              {expandedId === row.id ? t('table.hideHistory') : t('table.history')}
                            </button>
                            {isOpen && canCollect && (
                              <ActionButton
                                type="button"
                                className="btn-primary"
                                onClick={() => beginCollect(row)}
                              >
                                {t('table.collect')}
                              </ActionButton>
                            )}
                            {isOpen && canWaive && (
                              <button
                                type="button"
                                className="btn-danger-action"
                                onClick={() => {
                                  setCollectTarget(null);
                                  setWaiveTarget(row);
                                  setWaiveReason('');
                                }}
                              >
                                {t('table.waive')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === row.id && (
                        <tr>
                          <td colSpan={10} style={{ background: '#fafafa' }}>
                            {historyLoading ? (
                              <p style={{ margin: 8 }}>{t('actions.loading', { ns: 'common' })}</p>
                            ) : !history?.payments?.length ? (
                              <p style={{ margin: 8, color: '#666' }}>{t('history.empty')}</p>
                            ) : (
                              <table style={{ margin: 8, width: 'calc(100% - 16px)' }}>
                                <thead>
                                  <tr>
                                    <th>{t('history.paidAt')}</th>
                                    <th>{t('history.amount')}</th>
                                    <th>{t('history.remainingAfter')}</th>
                                    <th>{t('history.by')}</th>
                                    <th>{t('history.notes')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {history.payments.map((p) => (
                                    <tr key={p.id}>
                                      <td>{formatAppDateTime(p.paid_at)}</td>
                                      <td>{formatDisplayAmount(num(p.amount), p.currency)}</td>
                                      <td>
                                        {formatDisplayAmount(num(p.remaining_after), p.currency)}
                                      </td>
                                      <td>{p.created_by || '—'}</td>
                                      <td>{p.notes || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {history?.waived_at && (
                              <p style={{ margin: 8, color: '#b45309' }}>
                                {t('history.waived', {
                                  amount: formatDisplayAmount(
                                    num(history.waived_amount),
                                    history.currency,
                                  ),
                                  at: formatAppDateTime(history.waived_at),
                                  reason: history.waived_reason || '—',
                                })}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
