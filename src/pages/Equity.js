import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { useAuth } from '../contexts/AuthContext';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime, formatAppNumber } from '../utils/localeFormat';
import './TablePage.css';

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
    amount: '',
    currency: 'USD',
    balance_type: 'usd_cash',
    notes: '',
  });

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
    try {
      await api.post('/equity-transactions/', {
        ...form,
        amount: form.amount || 0,
      });
      setShowForm(false);
      setForm({
        equity_type: 'contribution',
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

  const totals = rows.reduce(
    (acc, r) => {
      const amt = parseFloat(r.amount) || 0;
      if (r.equity_type === 'contribution') acc.in += amt;
      else acc.out += amt;
      return acc;
    },
    { in: 0, out: 0 },
  );

  const equityTypeLabel = (type) =>
    type === 'contribution' ? t('types.contribution') : t('types.withdrawal');

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
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('form.type')}</label>
                <select
                  value={form.equity_type}
                  onChange={(e) => setForm({ ...form, equity_type: e.target.value })}
                >
                  <option value="contribution">{t('form.contributionOption')}</option>
                  <option value="withdrawal">{t('form.withdrawalOption')}</option>
                </select>
              </div>
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
                <input
                  type="number"
                  step="0.01"
                  min="0"
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
              <button type="submit" className="btn-primary">{t('actions.save', { ns: 'common' })}</button>
            </div>
          </form>
        </div>
      )}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.id')}</th>
              <th>{t('table.type')}</th>
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
                <td colSpan={7} style={{ textAlign: 'center' }}>
                  {t('table.noRows')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{equityTypeLabel(r.equity_type)}</td>
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
