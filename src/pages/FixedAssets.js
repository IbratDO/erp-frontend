import React, { useState, useEffect, useMemo } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { useAuth } from '../contexts/AuthContext';
import { cashBalanceTotalByCurrency, formatInsufficientLedgerMessage } from '../utils/currencyFormat';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppNumber } from '../utils/localeFormat';
import './TablePage.css';
import AmountInput from '../components/AmountInput';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';

const CATEGORY_VALUES = [
  'vehicle',
  'equipment',
  'computer',
  'machinery',
  'furniture',
  'building',
  'office_equipment',
  'other',
];

const defaultPaymentState = {
  assetId: null,
  action: 'pay',
  payment_uzs: '',
  payment_usd: '',
  notes: '',
};

const sanitizePaymentAmountInput = (raw) => {
  if (raw === '' || raw == null) return '';
  return String(raw).replace(/[$\s,]/g, '');
};

function formatApiError(data) {
  if (data == null) return null;
  if (typeof data === 'string') return data;
  if (data.error) return String(data.error);
  if (data.detail) return String(data.detail);
  return null;
}

const FixedAssets = () => {
  const { t } = useAppTranslation(['fixedAssets', 'common']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('fixed_assets.create');
  const [assets, setAssets] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(defaultPaymentState);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
  const [form, setForm] = useState({
    name: '',
    category: 'other',
    purchase_date: new Date().toISOString().slice(0, 10),
    purchase_cost: '',
    currency: 'USD',
    current_value: '',
    depreciation: '',
    notes: '',
    pay_immediately: false,
  });

  const categoryOptions = useMemo(
    () => CATEGORY_VALUES.map((value) => ({ value, label: t(`categories.${value}`) })),
    [t],
  );

  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 5000);
  };

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const { data } = await apiGetAll('/fixed-assets/');
      setAssets(data.results || data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalances = async () => {
    try {
      const { data } = await apiGetAll('/cash-balance/');
      setBalances(data.results || data);
    } catch (e) {
      setBalances([]);
    }
  };

  useEffect(() => {
    fetchAssets();
    fetchBalances();
  }, []);

  const getAvailableBalance = (currency) => cashBalanceTotalByCurrency(balances, currency);

  const formatCurrency = (currency) =>
    (currency || 'USD').toUpperCase() === 'UZS' ? uzsLabel : t('currency.usd', { ns: 'common' });

  const prefillPaymentForAsset = (asset, action) => {
    const cost = parseFloat(asset.purchase_cost) || 0;
    const ccy = (asset.currency || 'USD').toUpperCase();
    const uzs = ccy === 'UZS' && cost > 0 ? String(cost) : '';
    const usd = ccy === 'USD' && cost > 0 ? String(cost) : '';
    setPaymentForm({
      assetId: asset.id,
      action,
      payment_uzs: uzs,
      payment_usd: usd,
      notes: '',
    });
    setShowPaymentForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/fixed-assets/', {
        name: form.name,
        category: form.category,
        purchase_date: form.purchase_date,
        purchase_cost: form.purchase_cost || 0,
        currency: form.currency,
        current_value: form.current_value || form.purchase_cost || 0,
        depreciation: form.depreciation || null,
        notes: form.notes,
        pay_immediately: form.pay_immediately,
        payment_uzs: form.pay_immediately && form.currency === 'UZS' ? form.purchase_cost : 0,
        payment_usd: form.pay_immediately && form.currency === 'USD' ? form.purchase_cost : 0,
      });
      setShowForm(false);
      setForm({
        name: '',
        category: 'other',
        purchase_date: new Date().toISOString().slice(0, 10),
        purchase_cost: '',
        currency: 'USD',
        current_value: '',
        depreciation: '',
        notes: '',
        pay_immediately: false,
      });
      fetchAssets();
      fetchBalances();
      showNotification(t('notifications.saved'));
    } catch (err) {
      showNotification(formatApiError(err.response?.data) || t('notifications.saveFailed'), 'error');
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    const asset = assets.find((a) => a.id === paymentForm.assetId);
    if (!asset) return;

    const uzs = parseFloat(paymentForm.payment_uzs) || 0;
    const usd = parseFloat(paymentForm.payment_usd) || 0;
    const payload = {
      payment_uzs: uzs,
      payment_usd: usd,
      notes: paymentForm.notes,
    };

    if (paymentForm.action !== 'receive') {
      if (uzs + usd === 0) {
        showNotification(t('notifications.enterPayment'), 'error');
        return;
      }
      if (uzs > 0 && getAvailableBalance('UZS') < uzs) {
        showNotification(formatInsufficientLedgerMessage('UZS', getAvailableBalance('UZS'), uzs), 'error');
        return;
      }
      if (usd > 0 && getAvailableBalance('USD') < usd) {
        showNotification(formatInsufficientLedgerMessage('USD', getAvailableBalance('USD'), usd), 'error');
        return;
      }
    }

    let url = '';
    if (paymentForm.action === 'pay') url = `/fixed-assets/${asset.id}/pay_purchase/`;
    else if (paymentForm.action === 'receive') url = `/fixed-assets/${asset.id}/receive_asset/`;
    else if (paymentForm.action === 'sell') url = `/fixed-assets/${asset.id}/sell_asset/`;

    const finish = () => {
      setShowPaymentForm(false);
      setPaymentForm(defaultPaymentState);
      fetchAssets();
      fetchBalances();
      showNotification(t('notifications.updated'));
    };

    try {
      await api.post(url, payload);
      finish();
    } catch (err) {
      const data = err.response?.data;
      // Paying less than the recorded cost is allowed, but only once the user has seen what
      // it does: the asset's cost drops to what was actually handed over.
      if (data?.code === 'fixed_asset_underpayment') {
        const confirmed = window.confirm(
          t('confirmUnderpayment', {
            cost: formatAppNumber(data.cost),
            paid: formatAppNumber(data.paid),
            shortfall: formatAppNumber(data.shortfall),
            currency: formatCurrency(data.currency),
          })
        );
        if (!confirmed) return;
        try {
          await api.post(url, { ...payload, confirm_underpayment: true });
          finish();
        } catch (retryErr) {
          showNotification(
            formatApiError(retryErr.response?.data) || t('notifications.actionFailed'),
            'error'
          );
        }
        return;
      }
      showNotification(formatApiError(data) || t('notifications.actionFailed'), 'error');
    }
  };

  const handleReceive = async (asset) => {
    try {
      await api.post(`/fixed-assets/${asset.id}/receive_asset/`, {});
      fetchAssets();
      showNotification(t('notifications.received'));
    } catch (err) {
      showNotification(formatApiError(err.response?.data) || t('notifications.receiveFailed'), 'error');
    }
  };

  const handleWriteOff = async (asset) => {
    const notes = window.prompt(t('promptWriteOffNotes'), '') ?? '';
    if (!window.confirm(t('confirmWriteOff', { name: asset.name }))) return;
    try {
      await api.post(`/fixed-assets/${asset.id}/write_off/`, { notes });
      fetchAssets();
      fetchBalances();
      showNotification(t('notifications.writtenOff'));
    } catch (err) {
      showNotification(formatApiError(err.response?.data) || t('notifications.writeOffFailed'), 'error');
    }
  };

  const handleDelete = async (asset) => {
    if (!window.confirm(t('confirmDelete', { name: asset.name }))) return;
    try {
      await api.delete(`/fixed-assets/${asset.id}/`);
      fetchAssets();
      showNotification(t('notifications.removed'));
    } catch (err) {
      showNotification(formatApiError(err.response?.data) || t('notifications.deleteFailed'), 'error');
    }
  };

  const paymentTitle = () => {
    const a = assets.find((x) => x.id === paymentForm.assetId);
    if (!a) return t('payment.title');
    if (paymentForm.action === 'pay') return t('payment.payTitle', { id: a.id, name: a.name });
    if (paymentForm.action === 'receive') return t('payment.receiveTitle', { id: a.id, name: a.name });
    if (paymentForm.action === 'sell') return t('payment.sellTitle', { name: a.name });
    return t('payment.title');
  };

  if (loading) return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="fixedAssets" />
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? t('actions.cancel', { ns: 'common' }) : t('addAsset')}
          </button>
        )}
      </div>

      {notification.show && (
        <div className={`notification ${notification.type}`} style={{ marginBottom: 12 }}>
          {notification.message}
        </div>
      )}

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 820 }}>
        {t('intro')}
      </p>

      {showForm && isAdmin && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <h2>{t('form.newTitle')}</h2>
          <BusyForm onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('form.assetName')}</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('form.category')}</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categoryOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('form.purchaseDate')}</label>
                <input
                  type="date"
                  required
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('form.currency')}</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{uzsLabel}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('form.purchaseCost')}</label>
                <AmountInput
                  required
                  value={form.purchase_cost}
                  onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('form.currentValue')}</label>
                <AmountInput
                  value={form.current_value}
                  onChange={(e) => setForm({ ...form, current_value: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('form.depreciation')}</label>
                <AmountInput
                  value={form.depreciation}
                  onChange={(e) => setForm({ ...form, depreciation: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('form.notes')}</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.pay_immediately}
                    onChange={(e) => setForm({ ...form, pay_immediately: e.target.checked })}
                  />
                  {t('form.payImmediately')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {form.pay_immediately ? t('form.payNowReceiveLater') : t('form.createPurchaseOrder')}
              </SubmitButton>
            </div>
          </BusyForm>
        </div>
      )}

      {showPaymentForm && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <h2>{paymentTitle()}</h2>
          <BusyForm onSubmit={handlePaymentSubmit}>
            {paymentForm.action !== 'receive' && (
              <div className="form-grid">
                <div className="form-group">
                  <label>{t('payment.uzsPayment')}</label>
                  <AmountInput
                    value={paymentForm.payment_uzs}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        payment_uzs: sanitizePaymentAmountInput(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>{t('payment.usdPayment')}</label>
                  <AmountInput
                    value={paymentForm.payment_usd}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        payment_usd: sanitizePaymentAmountInput(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            )}
            {paymentForm.action === 'sell' && (
              <div className="form-group" style={{ marginTop: 8 }}>
                <label>{t('form.notes')}</label>
                <input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 12 }}>
              <SubmitButton className="btn-primary">{t('payment.confirm')}</SubmitButton>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowPaymentForm(false);
                  setPaymentForm(defaultPaymentState);
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
        </div>
      )}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.name')}</th>
              <th>{t('table.category')}</th>
              <th>{t('table.purchaseDate')}</th>
              <th>{t('table.cost')}</th>
              <th>{t('table.bookValue')}</th>
              <th>{t('table.purchase')}</th>
              <th>{t('table.status')}</th>
              {isAdmin && <th>{t('table.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center' }}>
                  {t('table.noRows')}
                </td>
              </tr>
            ) : (
              assets.map((a) => {
                const cost = parseFloat(a.purchase_cost) || 0;
                const showPay =
                  !a.is_paid &&
                  cost > 0 &&
                  (a.purchase_status === 'ordered' || a.purchase_status === 'received');
                const showReceive =
                  a.status === 'active' &&
                  a.purchase_status !== 'received' &&
                  (a.purchase_status === 'order_paid' || a.purchase_status === 'ordered');
                const onBooks = a.purchase_status === 'received' && a.status === 'active';
                const canDelete = a.purchase_status === 'ordered' && !a.is_paid;

                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{t(`categories.${a.category}`, { defaultValue: a.category })}</td>
                    <td>{a.purchase_date}</td>
                    <td>
                      {formatAppNumber(cost)} {formatCurrency(a.currency)}
                      {a.payable_status === 'pending' && a.purchase_status === 'received' && (
                        <div style={{ fontSize: '0.8em', color: '#c62828' }}>{t('table.payableOnCredit')}</div>
                      )}
                    </td>
                    <td>
                      {a.book_value_display} {formatCurrency(a.currency)}
                    </td>
                    <td>
                      <span className={`status-badge ${a.purchase_status}`}>
                        {t(`purchaseStatus.${a.purchase_status}`, { defaultValue: a.purchase_status })}
                      </span>
                      {a.is_paid && a.purchase_status !== 'received' && (
                        <span style={{ marginLeft: 6, fontSize: '0.8em', color: '#2e7d32' }}>{t('table.paid')}</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${a.status}`}>
                        {t(`assetStatus.${a.status}`, { defaultValue: a.status })}
                      </span>
                      {a.sale_price != null && a.status === 'sold' && (
                        <div style={{ fontSize: '0.8em' }}>
                          {t('table.sold', {
                            amount: formatAppNumber(a.sale_price),
                            currency: formatCurrency(a.sale_currency || a.currency),
                          })}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {showPay && (
                          <button
                            type="button"
                            className="btn-status"
                            style={{ marginRight: 4 }}
                            onClick={() => prefillPaymentForAsset(a, 'pay')}
                          >
                            {t('actions.pay')}
                          </button>
                        )}
                        {showReceive && (
                          <ActionButton
                            type="button"
                            className="btn-status"
                            style={{ marginRight: 4 }}
                            onClick={() => handleReceive(a)}
                          >
                            {t('actions.receive')}
                          </ActionButton>
                        )}
                        {onBooks && (
                          <>
                            <button
                              type="button"
                              className="btn-status"
                              style={{ marginRight: 4, backgroundColor: '#4caf50', color: '#fff' }}
                              onClick={() => prefillPaymentForAsset(a, 'sell')}
                            >
                              {t('actions.sell')}
                            </button>
                            <ActionButton
                              type="button"
                              className="btn-status"
                              style={{ marginRight: 4 }}
                              onClick={() => handleWriteOff(a)}
                            >
                              {t('actions.writeOff')}
                            </ActionButton>
                          </>
                        )}
                        {canDelete && (
                          <ActionButton
                            type="button"
                            className="btn-status"
                            onClick={() => handleDelete(a)}
                          >
                            {t('actions.remove')}
                          </ActionButton>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FixedAssets;
