import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { getCachedProducts } from '../utils/catalogCache';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime } from '../utils/localeFormat';
import FormSearchableSelect from '../components/FormSearchableSelect';
import './TablePage.css';

const emptyRule = () => ({
  user: '',
  product: '',
  category: '',
  sale_type: '',
  bonus_type: 'fixed',
  bonus_amount: '',
  bonus_percent: '',
  is_active: true,
});

const SALE_TYPE_VALUES = ['', 'bought_from_shop', 'delivery', 'from_order', 'reserved'];

const BonusRules = () => {
  const { t } = useAppTranslation(['bonusRules', 'common']);
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('bonus.manage');
  const [rules, setRules] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyRule());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, txRes, usersRes, products] = await Promise.all([
        apiGetAll('/bonus-rules/'),
        apiGetAll('/bonus-transactions/'),
        canManage ? apiGetAll('/users/') : Promise.resolve({ data: [] }),
        canManage ? getCachedProducts(api) : Promise.resolve([]),
      ]);
      setRules(rulesRes.data.results || rulesRes.data);
      setTransactions(txRes.data.results || txRes.data);
      setUsers(usersRes.data.results || usersRes.data);
      setProducts(products);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreate = () => {
    setEditingId(null);
    setFormData(emptyRule());
    setShowForm(true);
  };

  const openEdit = (rule) => {
    setEditingId(rule.id);
    setFormData({
      user: rule.user,
      product: rule.product || '',
      category: rule.category || '',
      sale_type: rule.sale_type || '',
      bonus_type: rule.bonus_type,
      bonus_amount: rule.bonus_amount,
      bonus_percent: rule.bonus_percent,
      is_active: rule.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      user: Number(formData.user),
      product: formData.product ? Number(formData.product) : null,
      category: formData.category || '',
      sale_type: formData.sale_type || '',
      bonus_type: formData.bonus_type,
      bonus_amount: formData.bonus_amount || 0,
      bonus_percent: formData.bonus_percent || 0,
      is_active: formData.is_active,
    };
    try {
      if (editingId) {
        await api.put(`/bonus-rules/${editingId}/`, payload);
      } else {
        await api.post('/bonus-rules/', payload);
      }
      setShowForm(false);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.error || t('notifications.saveFailed'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api.delete(`/bonus-rules/${id}/`);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.detail || t('notifications.deleteFailed'));
    }
  };

  const saleTypeLabel = (type) =>
    type ? t(`saleTypes.${type}`) : t('form.any');

  if (loading) return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="bonusRules" />
        {canManage && (
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t('newRule')}
          </button>
        )}
      </div>

      {showForm && canManage && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <h2>{editingId ? t('form.editTitle') : t('form.newTitle')}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                {t('form.salesManager')}
                <FormSearchableSelect
                  value={formData.user}
                  onChange={(v) => setFormData({ ...formData, user: v })}
                  options={users.map((u) => ({ value: String(u.id), label: `${u.username} (${u.role_name || u.role_code})` }))}
                  emptyLabel={t('form.selectUser')}
                  placeholder={t('form.selectUser')}
                  aria-label={t('form.salesManager')}
                />
              </label>
              <label>
                {t('form.productOptional')}
                <FormSearchableSelect
                  value={formData.product}
                  onChange={(v) => setFormData({ ...formData, product: v })}
                  options={products.map((p) => ({ value: String(p.id), label: `${p.brand} ${p.model}` }))}
                  emptyLabel={t('form.anyProduct')}
                  placeholder={t('form.anyProduct')}
                  aria-label={t('form.productOptional')}
                />
              </label>
              <label>
                {t('form.categoryOptional')}
                <input value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder={t('form.categoryPlaceholder')} />
              </label>
              <label>
                {t('form.saleTypeOptional')}
                <select value={formData.sale_type} onChange={(e) => setFormData({ ...formData, sale_type: e.target.value })}>
                  {SALE_TYPE_VALUES.map((value) => (
                    <option key={value || 'any'} value={value}>
                      {saleTypeLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('form.bonusType')}
                <select value={formData.bonus_type} onChange={(e) => setFormData({ ...formData, bonus_type: e.target.value })}>
                  <option value="fixed">{t('form.fixedPerUnit')}</option>
                  <option value="percent">{t('form.percentRevenue')}</option>
                </select>
              </label>
              {formData.bonus_type === 'fixed' ? (
                <label>
                  {t('form.amountPerUnit')}
                  <input type="number" step="0.01" required value={formData.bonus_amount} onChange={(e) => setFormData({ ...formData, bonus_amount: e.target.value })} />
                </label>
              ) : (
                <label>
                  {t('form.percent')}
                  <input type="number" step="0.01" required value={formData.bonus_percent} onChange={(e) => setFormData({ ...formData, bonus_percent: e.target.value })} />
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} />
                {t('form.active')}
              </label>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary">{t('actions.save', { ns: 'common' })}</button>
              <button type="button" className="btn-edit" onClick={() => setShowForm(false)}>{t('actions.cancel', { ns: 'common' })}</button>
            </div>
          </form>
        </div>
      )}

      <div className="table-card" style={{ marginBottom: 24 }}>
        <h3 style={{ padding: '12px 16px', margin: 0 }}>{t('rulesTable.title')}</h3>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('rulesTable.manager')}</th>
                <th>{t('rulesTable.target')}</th>
                <th>{t('rulesTable.type')}</th>
                <th>{t('rulesTable.value')}</th>
                <th>{t('rulesTable.active')}</th>
                {canManage && <th>{t('rulesTable.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={canManage ? 6 : 5} style={{ textAlign: 'center' }}>{t('rulesTable.noRows')}</td></tr>
              ) : rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.username || r.user}</td>
                  <td>{r.product_name || r.category || (r.sale_type ? saleTypeLabel(r.sale_type) : t('rulesTable.allSales'))}</td>
                  <td>{r.bonus_type}</td>
                  <td>{r.bonus_type === 'percent' ? `${r.bonus_percent}%` : r.bonus_amount}</td>
                  <td>{r.is_active ? t('rulesTable.yes') : t('rulesTable.no')}</td>
                  {canManage && (
                    <td>
                      <button type="button" className="btn-edit" onClick={() => openEdit(r)}>{t('actions.edit', { ns: 'common' })}</button>
                      {' '}
                      <button type="button" className="btn-delete" onClick={() => handleDelete(r.id)}>{t('actions.delete', { ns: 'common' })}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <h3 style={{ padding: '12px 16px', margin: 0 }}>{t('transactionsTable.title')}</h3>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('transactionsTable.date')}</th>
                <th>{t('transactionsTable.manager')}</th>
                <th>{t('transactionsTable.sale')}</th>
                <th>{t('transactionsTable.amount')}</th>
                <th>{t('transactionsTable.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>{t('transactionsTable.noRows')}</td></tr>
              ) : transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatAppDateTime(tx.created_at)}</td>
                  <td>{tx.username || tx.user}</td>
                  <td>#{tx.sale}</td>
                  <td>{parseFloat(tx.amount).toLocaleString()}</td>
                  <td>{tx.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BonusRules;
