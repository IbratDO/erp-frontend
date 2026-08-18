import React, { useState, useEffect, useMemo } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { useAuth } from '../contexts/AuthContext';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime, formatAppNumber } from '../utils/localeFormat';
import './TablePage.css';
import AmountInput from '../components/AmountInput';
import FormSearchableSelect from '../components/FormSearchableSelect';
import BusyForm, { SubmitButton } from '../components/BusyForm';

/** Types that name an owner and move that owner's share — mirrors
 *  `EquityTransaction.OWNER_ATTRIBUTED_TYPES` on the backend. A withdrawal is drawings and
 *  carries no owner, so it appears in neither the Egasi field nor the Hissalar table. */
const OWNER_ATTRIBUTED_TYPES = ['contribution', 'share_reduction'];

const Equity = () => {
  const { t } = useAppTranslation(['equity', 'common']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('equity.create');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    equity_type: 'contribution',
    owner: '',
    amount: '',
    currency: 'USD',
    balance_type: 'usd_cash',
    notes: '',
  });

  /** The owner list is the names already used, so a new one needs no setup step —
   *  same pattern as brand/category on the Products page. Withdrawals carry no owner,
   *  so they contribute nothing to the list. */
  const ownerOptions = useMemo(
    () => [...new Set(rows.map((r) => (r.owner || '').trim()).filter(Boolean))].sort(),
    [rows],
  );
  const ownerRequired = OWNER_ATTRIBUTED_TYPES.includes(form.equity_type);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data } = await apiGetAll('/equity-transactions/');
      setRows(data.results || data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // FormSearchableSelect is not a native input, so the browser's own `required` never
    // fires on it — check here as well as on the server.
    if (ownerRequired && !(form.owner || '').trim()) {
      alert(t('form.ownerRequired'));
      return;
    }
    try {
      await api.post('/equity-transactions/', {
        ...form,
        amount: form.amount || 0,
      });
      setShowForm(false);
      setForm({
        equity_type: 'contribution',
        owner: '',
        amount: '',
        currency: 'USD',
        balance_type: 'usd_cash',
        notes: '',
      });
      fetchRows();
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.error || t('notifications.saveFailed'));
    }
  };

  /** Hissalar is the *net* stake: contributions less share reductions. Yechib olish is
   *  drawings — cash out that leaves stakes alone — so it stays in its own card and is
   *  deliberately not subtracted here. */
  const totals = rows.reduce(
    (acc, r) => {
      const amt = parseFloat(r.amount) || 0;
      if (r.equity_type === 'contribution') acc.in += amt;
      else if (r.equity_type === 'share_reduction') acc.in -= amt;
      else acc.out += amt;
      return acc;
    },
    { in: 0, out: 0 },
  );

  /**
   * Per-owner stake, split by currency.
   *
   * Deliberately **not** one combined number: adding 27,762 USD to 1,200,000 UZS produces a
   * figure that means nothing. Each currency is totalled on its own and a column the owner
   * has never used reads '—'.
   */
  const ownerShares = useMemo(() => {
    const byOwner = new Map();
    for (const r of rows) {
      if (!OWNER_ATTRIBUTED_TYPES.includes(r.equity_type)) continue;
      const name = (r.owner || '').trim();
      if (!name) continue;
      if (!byOwner.has(name)) byOwner.set(name, { owner: name, USD: 0, UZS: 0, count: 0 });
      const row = byOwner.get(name);
      const sign = r.equity_type === 'contribution' ? 1 : -1;
      const ccy = (r.currency || 'USD').toUpperCase() === 'UZS' ? 'UZS' : 'USD';
      row[ccy] += sign * (parseFloat(r.amount) || 0);
      row.count += 1;
    }
    return [...byOwner.values()].sort((a, b) => b.USD - a.USD || a.owner.localeCompare(b.owner));
  }, [rows]);

  const equityTypeLabel = (type) => {
    if (type === 'contribution') return t('types.contribution');
    if (type === 'share_reduction') return t('types.shareReduction');
    return t('types.withdrawal');
  };

  const shareCell = (value) =>
    value === 0 ? <span style={{ color: '#999' }}>—</span> : formatAppNumber(value);

  if (loading) return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="equity" />
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? t('actions.cancel', { ns: 'common' }) : t('newTransaction')}
          </button>
        )}
      </div>
      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 720 }}>
        {t('intro')}
      </p>

      <div className="metrics-grid" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <div className="metric-label">{t('metrics.contributions')}</div>
          <div className="metric-value" style={{ color: '#28a745' }}>
            {formatAppNumber(totals.in, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t('metrics.withdrawals')}</div>
          <div className="metric-value" style={{ color: '#dc3545' }}>
            {formatAppNumber(totals.out, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {showForm && isAdmin && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <h2>{t('form.title')}</h2>
          <BusyForm onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('form.type')}</label>
                <select
                  value={form.equity_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      equity_type: e.target.value,
                      // A withdrawal is not attributed to an owner; drop anything already
                      // picked so switching type cannot smuggle a stale name through.
                      owner: OWNER_ATTRIBUTED_TYPES.includes(e.target.value) ? form.owner : '',
                    })
                  }
                >
                  <option value="contribution">{t('form.contributionOption')}</option>
                  <option value="share_reduction">{t('form.shareReductionOption')}</option>
                  <option value="withdrawal">{t('form.withdrawalOption')}</option>
                </select>
              </div>
              {ownerRequired && (
                <div className="form-group">
                  <label>
                    {t('form.owner')} <span style={{ color: '#e53e3e' }}>*</span>
                  </label>
                  <FormSearchableSelect
                    value={form.owner}
                    onChange={(v) => setForm({ ...form, owner: v })}
                    options={ownerOptions}
                    emptyLabel={t('form.selectOwner')}
                    placeholder={t('form.ownerPlaceholder')}
                    allowFreeText
                    freeTextApplyLabel={`${t('form.addNewOwner')}: "{{query}}"`}
                    aria-label={t('form.owner')}
                  />
                </div>
              )}
              <div className="form-group">
                <label>{t('form.currency')}</label>
                <select
                  value={form.currency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      currency: e.target.value,
                      balance_type: e.target.value === 'UZS' ? 'uzs_cash' : 'usd_cash',
                    })
                  }
                >
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{uzsLabel}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('form.amount')}</label>
                <AmountInput
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('form.notes')}</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">{t('actions.save', { ns: 'common' })}</SubmitButton>
            </div>
          </BusyForm>
        </div>
      )}

      {/* Who holds what. Contributions add, share reductions subtract; withdrawals are
          drawings and never appear here. */}
      <div className="table-card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem' }}>{t('shares.title')}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('shares.owner')}</th>
              <th>{t('currency.usd', { ns: 'common' })}</th>
              <th>{uzsLabel}</th>
              <th>{t('shares.entries')}</th>
            </tr>
          </thead>
          <tbody>
            {ownerShares.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center' }}>{t('shares.noRows')}</td>
              </tr>
            ) : (
              ownerShares.map((s) => (
                <tr key={s.owner}>
                  <td><strong>{s.owner}</strong></td>
                  <td>{shareCell(s.USD)}</td>
                  <td>{shareCell(s.UZS)}</td>
                  <td>{s.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem' }}>{t('history.title')}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.id')}</th>
              <th>{t('table.type')}</th>
              <th>{t('table.owner')}</th>
              <th>{t('table.amount')}</th>
              <th>{t('table.currency')}</th>
              <th>{t('table.date')}</th>
              <th>{t('table.notes')}</th>
              <th>{t('table.by')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center' }}>
                  {t('table.noRows')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{equityTypeLabel(r.equity_type)}</td>
                  <td>{r.owner || '—'}</td>
                  <td>{formatAppNumber(r.amount)}</td>
                  <td>{r.currency === 'UZS' ? uzsLabel : t('currency.usd', { ns: 'common' })}</td>
                  <td>{formatAppDateTime(r.transaction_date)}</td>
                  <td>{r.notes || '—'}</td>
                  <td>{r.created_by_username || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Equity;
