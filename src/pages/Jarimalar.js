import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppNumber } from '../utils/localeFormat';
import FormSearchableSelect from '../components/FormSearchableSelect';
import './TablePage.css';
import AmountInput from '../components/AmountInput';

const EMPTY_FILTERS = {
  employee: '',
  currency: '',
  year: '',
  month: '',
  created_by: '',
};

function managerDisplayName(detail, fallbackId = '') {
  if (!detail) return fallbackId ? String(fallbackId) : '—';
  return (
    [detail.username, detail.first_name, detail.last_name].filter(Boolean).join(' ') ||
    detail.username ||
    '—'
  );
}

const Jarimalar = () => {
  const { t, monthOptions } = useAppTranslation(['penalties', 'common']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('penalties.manage');
  const [rows, setRows] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    employee: '',
    points: '',
    amount: '',
    currency: 'USD',
    reason: '',
    penalty_date: new Date().toISOString().slice(0, 10),
  });

  const managerOptionLabel = useCallback(
    (m) =>
      [m.username, m.first_name, m.last_name].filter(Boolean).join(' ') ||
      m.username ||
      t('userFallback', { id: m.id }),
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [penRes, mgrRes] = await Promise.all([
        apiGetAll('/penalties/'),
        apiGetAll('/penalties/managers/'),
      ]);
      setRows(penRes.data.results || penRes.data || []);
      setManagers(mgrRes.data || []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  const assignerOptions = useMemo(() => {
    const map = new Map();
    for (const p of rows) {
      const d = p.created_by_detail;
      if (d?.id != null) {
        map.set(d.id, managerDisplayName(d, d.id));
      }
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id: String(id), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((p) => {
      if (filters.employee && String(p.employee) !== filters.employee) return false;
      if (filters.currency && (p.currency || 'USD') !== filters.currency) return false;
      if (filters.created_by && String(p.created_by) !== filters.created_by) return false;
      if (filters.year || filters.month) {
        const d = p.penalty_date ? new Date(p.penalty_date) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (filters.year && d.getFullYear().toString() !== filters.year) return false;
        if (filters.month && (d.getMonth() + 1).toString() !== filters.month) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const columnTotals = useMemo(() => {
    let points = 0;
    let usd = 0;
    let uzs = 0;
    for (const p of filteredRows) {
      points += parseFloat(p.points) || 0;
      const amt = parseFloat(p.amount) || 0;
      if ((p.currency || 'USD') === 'UZS') uzs += amt;
      else usd += amt;
    }
    return { count: filteredRows.length, points, usd, uzs };
  }, [filteredRows]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      employee: '',
      points: '',
      amount: '',
      currency: 'USD',
      reason: '',
      penalty_date: new Date().toISOString().slice(0, 10),
    });
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      employee: String(row.employee),
      points: String(row.points),
      amount: String(row.amount),
      currency: row.currency || 'USD',
      reason: row.reason || '',
      penalty_date: row.penalty_date,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      employee: parseInt(form.employee, 10),
      points: parseFloat(form.points) || 0,
      amount: parseFloat(form.amount) || 0,
      currency: form.currency,
      reason: form.reason.trim(),
      penalty_date: form.penalty_date,
    };
    try {
      if (editing) {
        await api.patch(`/penalties/${editing.id}/`, payload);
      } else {
        await api.post('/penalties/', payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.error || t('notifications.saveFailed'));
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api.delete(`/penalties/${row.id}/`);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || t('notifications.deleteFailed'));
    }
  };

  const formatCurrency = (currency) => (currency === 'UZS' ? uzsLabel : t('currency.usd', { ns: 'common' }));

  if (!canManage) {
    return <div className="page-container">{t('accessDenied')}</div>;
  }

  if (loading) return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="penalties" />
        <button type="button" className="btn-primary" onClick={openCreate}>
          {t('addPenalty')}
        </button>
      </div>

      {showForm && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>{editing ? t('form.editTitle') : t('form.newTitle')}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('form.manager')}</label>
                <FormSearchableSelect
                  value={form.employee}
                  onChange={(v) => setForm({ ...form, employee: v })}
                  options={managers.map((m) => ({
                    value: String(m.id),
                    label: `${managerOptionLabel(m)} (${m.role_name || m.role_code})`,
                  }))}
                  emptyLabel={t('form.selectManager')}
                  placeholder={t('form.selectManager')}
                  aria-label={t('form.manager')}
                />
              </div>
              <div className="form-group">
                <label>{t('form.date')}</label>
                <input
                  type="date"
                  value={form.penalty_date}
                  onChange={(e) => setForm({ ...form, penalty_date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('form.points')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.points}
                  onChange={(e) => setForm({ ...form, points: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('form.amount')}</label>
                <AmountInput
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('form.currency')}</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{uzsLabel}</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('form.reason')}</label>
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  required
                />
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary">
                {t('actions.save', { ns: 'common' })}
              </button>
              <button type="button" className="btn-edit" onClick={() => setShowForm(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <div className="form-card filter-card" style={{ marginBottom: '16px' }}>
          <h3 className="filter-card__title">{t('filters.title')}</h3>
          <div className="filter-toolbar">
            <div className="filter-field">
              <label>{t('filters.manager')}</label>
              <select
                value={filters.employee}
                onChange={(e) => setFilters({ ...filters, employee: e.target.value })}
              >
                <option value="">{t('filters.allManagers')}</option>
                {managers.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {managerOptionLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>{t('filters.currency')}</label>
              <select
                value={filters.currency}
                onChange={(e) => setFilters({ ...filters, currency: e.target.value })}
              >
                <option value="">{t('filters.allCurrencies')}</option>
                <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                <option value="UZS">{uzsLabel}</option>
              </select>
            </div>
            <div className="filter-field">
              <label>{t('filters.assignedBy')}</label>
              <select
                value={filters.created_by}
                onChange={(e) => setFilters({ ...filters, created_by: e.target.value })}
              >
                <option value="">{t('filters.allAssigners')}</option>
                {assignerOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>{t('filters.year')}</label>
              <select
                value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: e.target.value })}
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
                value={filters.month}
                onChange={(e) => setFilters({ ...filters, month: e.target.value })}
              >
                <option value="">{t('filters.allMonths')}</option>
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-toolbar__actions">
              <button type="button" className="btn-edit" onClick={() => setFilters(EMPTY_FILTERS)}>
                {t('filters.clearAll')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-card">
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('table.date')}</th>
                <th>{t('table.manager')}</th>
                <th>{t('table.points')}</th>
                <th>{t('table.amount')}</th>
                <th>{t('table.reason')}</th>
                <th>{t('table.assignedBy')}</th>
                <th>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center' }}>
                    {rows.length === 0 ? t('table.noRows') : t('table.noMatch')}
                  </td>
                </tr>
              ) : (
                filteredRows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.penalty_date}</td>
                    <td>{managerDisplayName(p.employee_detail, p.employee)}</td>
                    <td>{p.points}</td>
                    <td>
                      {p.amount} {formatCurrency(p.currency)}
                    </td>
                    <td style={{ maxWidth: 240 }}>{p.reason}</td>
                    <td>{managerDisplayName(p.created_by_detail)}</td>
                    <td>
                      <button type="button" className="btn-edit" onClick={() => openEdit(p)}>
                        {t('actions.edit', { ns: 'common' })}
                      </button>{' '}
                      <button type="button" className="btn-delete" onClick={() => handleDelete(p)}>
                        {t('actions.delete', { ns: 'common' })}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>
                  {t('table.total', { count: columnTotals.count.toLocaleString() })}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {formatAppNumber(columnTotals.points, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {[
                    columnTotals.usd > 0
                      ? `$${formatAppNumber(columnTotals.usd, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : null,
                    columnTotals.uzs > 0
                      ? `${formatAppNumber(columnTotals.uzs, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })} ${uzsLabel}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td colSpan={3}>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Jarimalar;
