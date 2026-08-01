import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import SaleCompletePayForm from '../components/SaleCompletePayForm';
import SaleDeliverySettlementForm from '../components/SaleDeliverySettlementForm';
import ShopDeliverySettlementButtons from '../components/ShopDeliverySettlementButtons';
import { shopDeliverySettlementRequired } from '../utils/saleCompletePayHelpers';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppNumber, formatAppDateTime } from '../utils/localeFormat';
import FormSearchableSelect from '../components/FormSearchableSelect';

const saleReadyToComplete = (sale) => !!(sale && sale.status === 'dispatched');

/** Synthetic “partner” row for BTS (company) dispatches — not a DB dispatcher id. */
const BTS_ROW_ID = 'bts';

const DISPATCH_STATUS_VALUES = [
  'preparing',
  'dispatched',
  'in_transit',
  'delivered',
  'returned',
  'failed',
];

const productLine = (sale) => {
  if (!sale?.product_detail) return '—';
  const p = sale.product_detail;
  return `${p.brand || ''} ${p.model || ''}`.trim() + (p.size ? ` · ${p.size}` : '') + (p.color ? ` (${p.color})` : '');
};

/** Lowercase key for client-side sort (matches visual product column). */
function productLineSortKey(sale) {
  if (!sale?.product_detail) return '';
  const p = sale.product_detail;
  return `${p.brand || ''} ${p.model || ''} ${p.size || ''} ${p.color || ''}`.trim().toLowerCase();
}

/** Rough single-number sort for mixed UZS + USD delivery cost display column. */
function dispatchCostSortApprox(row) {
  return (parseFloat(row.delivery_cost_uzs) || 0) / 12500 + (parseFloat(row.delivery_cost) || 0);
}

const PARTNER_DISPATCHER_SORT_ACCESSORS = {
  name: (d) => String(d.name ?? '').toLowerCase(),
  login: (d) => String(d.login_username ?? '').toLowerCase(),
  telephone: (d) => String(d.telephone ?? '').toLowerCase(),
  loads: (d) => Number(d.dispatch_count) || 0,
  active: (d) => (d.is_active !== false ? 1 : 0),
};

const DISPATCH_SHIPMENT_SORT_ACCESSORS = {
  sale_id: (row) => Number(row.sale_detail?.id) || 0,
  product: (row) => productLineSortKey(row.sale_detail),
  customer: (row) => String(row.sale_detail?.customer_detail?.name ?? '').toLowerCase(),
  sale_status: (row) => String(row.sale_detail?.status ?? '').toLowerCase(),
  dispatch_date: (row) => new Date(row.dispatch_date).getTime() || 0,
  dispatch_type_key: (row) => String(row.dispatch_type ?? '').toLowerCase(),
  delivery_cost_key: (row) => dispatchCostSortApprox(row),
  is_paid: (row) => (row.is_paid ? 1 : 0),
  status: (row) => String(row.status ?? '').toLowerCase(),
  delivered_at: (row) => new Date(row.delivered_at).getTime() || 0,
  tracking_number: (row) => String(row.tracking_number ?? '').toLowerCase(),
  logistics_notes: (row) => String(row.logistics_notes ?? '').toLowerCase(),
};

const ALL_DELIVERIES_SORT_ACCESSORS = {
  id: (row) => Number(row.id) || 0,
  sale_id: (row) => Number(row.sale_detail?.id) || 0,
  product: (row) => productLineSortKey(row.sale_detail),
  customer: (row) => String(row.sale_detail?.customer_detail?.name ?? '').toLowerCase(),
  dispatch_type_key: (row) => String(row.dispatch_type ?? '').toLowerCase(),
  delivery_cost_key: (row) => dispatchCostSortApprox(row),
  dispatcher_name: (row) => String(row.dispatcher_detail?.name ?? '').toLowerCase(),
  status: (row) => String(row.status ?? '').toLowerCase(),
  delivered_at: (row) => new Date(row.delivered_at).getTime() || 0,
  logistics_notes: (row) => String(row.logistics_notes ?? '').toLowerCase(),
};

const STATUS_TIMELINE_SORT_ACCESSORS = {
  timestamp: (log) => new Date(log.timestamp).getTime() || 0,
  dispatch_num: (log) => Number(log.object_id) || 0,
  previous_status: (log) => String(log.previous_status ?? '').toLowerCase(),
  new_status: (log) => String(log.new_status ?? '').toLowerCase(),
  changed_by: (log) => String(log.changed_by_detail?.username ?? '').toLowerCase(),
  notes: (log) => String(log.notes ?? '').toLowerCase(),
};

const formatCost = (d, uzsLabel = 'UZS') => {
  const uzs = d.delivery_cost_uzs != null && parseFloat(d.delivery_cost_uzs) !== 0;
  const usd = d.delivery_cost != null && parseFloat(d.delivery_cost) !== 0;
  const parts = [];
  if (uzs) parts.push(`${formatAppNumber(d.delivery_cost_uzs)} ${uzsLabel}`);
  if (usd) parts.push(`$${parseFloat(d.delivery_cost).toFixed(2)}`);
  return parts.length ? parts.join(' · ') : '—';
};

const DISPATCH_OPEN_STATUSES = new Set(['preparing', 'dispatched', 'in_transit']);

const Dispatchers = () => {
  const { t, tStatus } = useAppTranslation(['dispatchers', 'common', 'status', 'sales']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });

  const dispatchStatusOptions = useMemo(
    () => [
      { value: '', label: t('filters.allStatuses') },
      ...DISPATCH_STATUS_VALUES.map((value) => ({
        value,
        label: tStatus(value, 'dispatch'),
      })),
    ],
    [t, tStatus],
  );

  const statusOptionsRow = useMemo(
    () => dispatchStatusOptions.filter((s) => s.value),
    [dispatchStatusOptions],
  );

  const dispatchTypeLabel = useCallback(
    (type) => t(`serviceTypes.${type === 'bts' ? 'bts' : 'dostavshik'}`),
    [t],
  );

  const { hasPermission, hasAnyPermission, roleCode } = usePermissions();
  const isDispatcherRole = roleCode === 'dispatcher';
  const canManagePartners = hasPermission('dispatchers.manage');
  const canCompletePay = hasPermission('sales.complete_pay');
  const canDeliveryReceive = hasPermission('sales.delivery_customer_paid');
  const canDeliverySettle = hasAnyPermission([
    'sales.delivery_customer_paid',
    'sales.delivery_shop_received',
  ]);
  const canShowCompleteActions = isDispatcherRole
    ? canDeliveryReceive
    : canCompletePay || canDeliverySettle;

  const [loading, setLoading] = useState(true);
  const [dispatchers, setDispatchers] = useState([]);
  const [activeDispatchers, setActiveDispatchers] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedDispatcher, setSelectedDispatcher] = useState(null);
  const [dispatcherDetail, setDispatcherDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [completePaySale, setCompletePaySale] = useState(null);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'info' });

  const showNotification = (message, type = 'info') => {
    setNotification({ show: true, message, type });
    window.setTimeout(() => {
      setNotification((n) => (n.show ? { show: false, message: '', type: 'info' } : n));
    }, 4000);
  };

  const [formData, setFormData] = useState({
    name: '',
    telephone: '+998',
    notes: '',
    is_active: true,
  });
  const [filters, setFilters] = useState({
    status: '',
    dispatcher: '',
    serviceType: '',
  });
  const [btsLoadCount, setBtsLoadCount] = useState(null);

  const allDeliveriesCostTotals = useMemo(() => {
    let uzs = 0;
    let usd = 0;
    for (const row of dispatches) {
      uzs += parseFloat(row.delivery_cost_uzs) || 0;
      usd += parseFloat(row.delivery_cost) || 0;
    }
    return { uzs, usd };
  }, [dispatches]);

  const fetchDispatchers = useCallback(async () => {
    if (isDispatcherRole) return;
    try {
      const res = await apiGetAll('/dispatchers/');
      const list = res.data.results || res.data;
      setDispatchers(list);
    } catch (e) {
      console.error('Error fetching dispatchers:', e);
    }
  }, [isDispatcherRole]);

  const fetchActiveDispatchers = useCallback(async () => {
    if (isDispatcherRole) return;
    try {
      const res = await apiGetAll('/dispatchers/', { params: { is_active: true } });
      const list = res.data.results || res.data;
      setActiveDispatchers(list);
    } catch (e) {
      console.error('Error fetching active dispatchers:', e);
    }
  }, [isDispatcherRole]);

  const fetchDispatches = useCallback(async () => {
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.dispatcher) params.dispatcher = filters.dispatcher;
      if (filters.serviceType) params.dispatch_type = filters.serviceType;
      const res = await apiGetAll('/dispatches/', { params });
      const list = res.data.results || res.data;
      setDispatches(list);
    } catch (e) {
      console.error('Error fetching dispatches:', e);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.dispatcher, filters.serviceType]);

  const loadDispatcherDetail = useCallback(async (dispatcher) => {
    setDetailLoading(true);
    setDispatcherDetail(null);
    try {
      const res = await api.get(`/dispatchers/${dispatcher.id}/deliveries/`);
      setDispatcherDetail(res.data);
    } catch (e) {
      console.error('Error loading dispatcher deliveries:', e);
      alert(t('errors.loadHistoryFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const loadBtsDetail = useCallback(async () => {
    setDetailLoading(true);
    setDispatcherDetail(null);
    try {
      const res = await api.get('/dispatchers/bts-deliveries/');
      setDispatcherDetail(res.data);
      if (res.data?.summary?.total_dispatches != null) {
        setBtsLoadCount(res.data.summary.total_dispatches);
      }
    } catch (e) {
      console.error('Error loading BTS deliveries:', e);
      alert(t('errors.loadBtsFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const fetchBtsCount = useCallback(async () => {
    try {
      const res = await api.get('/dispatches/', { params: { dispatch_type: 'bts', page_size: 1 } });
      if (typeof res.data.count === 'number') {
        setBtsLoadCount(res.data.count);
        return;
      }
      const list = res.data.results || res.data;
      setBtsLoadCount(Array.isArray(list) ? list.length : 0);
    } catch (e) {
      console.error('Error counting BTS dispatches:', e);
    }
  }, []);

  const afterDispatchMutation = useCallback(async () => {
    await fetchDispatches();
    await fetchDispatchers();
    await fetchActiveDispatchers();
    if (selectedDispatcher?.isBts) {
      try {
        const res = await api.get('/dispatchers/bts-deliveries/');
        setDispatcherDetail(res.data);
        if (res.data?.summary?.total_dispatches != null) {
          setBtsLoadCount(res.data.summary.total_dispatches);
        }
      } catch (e) {
        console.error(e);
      }
    } else if (selectedDispatcher && !selectedDispatcher.isBts) {
      try {
        const res = await api.get(`/dispatchers/${selectedDispatcher.id}/deliveries/`);
        setDispatcherDetail(res.data);
      } catch (e) {
        console.error(e);
      }
    }
    await fetchBtsCount();
  }, [selectedDispatcher, fetchDispatches, fetchDispatchers, fetchActiveDispatchers, fetchBtsCount]);

  useEffect(() => {
    fetchDispatchers();
    fetchActiveDispatchers();
  }, [fetchDispatchers, fetchActiveDispatchers]);

  useEffect(() => {
    fetchDispatches();
  }, [fetchDispatches]);

  useEffect(() => {
    fetchBtsCount();
  }, [fetchBtsCount]);

  const handleRowSelect = (d) => {
    if (d.is_bts_channel) {
      setSelectedDispatcher({ ...d, isBts: true });
      loadBtsDetail();
      return;
    }
    setSelectedDispatcher(d);
    loadDispatcherDetail(d);
  };

  /** When the BTS DB row was deleted, keep a synthetic row to open the BTS workspace. */
  const handleSyntheticBtsRowSelect = () => {
    setSelectedDispatcher({ id: BTS_ROW_ID, name: 'BTS', isBts: true, synthetic: true });
    loadBtsDetail();
  };

  const handleRestoreBtsPartner = async () => {
    try {
      await api.post('/dispatchers/ensure-bts/');
      await fetchDispatchers();
      await fetchActiveDispatchers();
      await fetchBtsCount();
      showNotification(t('notifications.btsRestored'), 'success');
    } catch (e) {
      console.error(e);
      showNotification(e.response?.data?.detail || t('notifications.restoreBtsFailed'), 'error');
    }
  };

  const handleDispatcherSubmit = async (e) => {
    e.preventDefault();
    const name = String(formData.name || '').trim();
    const telephone = String(formData.telephone || '').trim();
    if (!name) {
      showNotification(t('notifications.nameRequired'), 'error');
      return;
    }
    if (!telephone || telephone === '+998') {
      showNotification(t('notifications.telephoneRequired'), 'error');
      return;
    }
    try {
      const payload = {
        name,
        telephone,
        notes: String(formData.notes || '').trim(),
        is_active: formData.is_active,
      };
      if (!formData.id) return;
      await api.put(`/dispatchers/${formData.id}/`, payload);
      setShowForm(false);
      setFormData({ name: '', telephone: '+998', notes: '', is_active: true });
      fetchDispatchers();
      fetchActiveDispatchers();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.detail || JSON.stringify(err.response?.data) || t('notifications.saveFailed'));
    }
  };

  const handleEditDispatcher = (d) => {
    setFormData({
      id: d.id,
      name: d.name || '',
      telephone: d.telephone || '+998',
      notes: d.notes || '',
      is_active: d.is_active !== false,
    });
    setShowForm(true);
  };

  const handleDeleteDispatcher = async (id) => {
    const row = dispatchers.find((x) => x.id === id);
    const message = row?.is_bts_channel
      ? t('confirm.deleteBts')
      : t('confirm.deleteDispatcher');
    if (!window.confirm(message)) return;
    try {
      await api.delete(`/dispatchers/${id}/`);
      if (selectedDispatcher?.id === id) {
        setSelectedDispatcher(null);
        setDispatcherDetail(null);
      }
      fetchDispatchers();
      fetchActiveDispatchers();
      fetchDispatches();
      fetchBtsCount();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.detail || t('errors.deleteFailed'));
    }
  };

  const patchDispatch = async (id, data) => {
    await api.patch(`/dispatches/${id}/`, data);
    await afterDispatchMutation();
  };

  const postDispatchStatus = async (id, status, notes) => {
    await api.post(`/dispatches/${id}/update_status/`, {
      status,
      notes: String(notes ?? '').trim(),
    });
    await afterDispatchMutation();
  };

  const applyDispatchRowStatusChange = async (row, newStatus) => {
    try {
      await postDispatchStatus(row.id, newStatus, '');
    } catch (err) {
      console.error(err);
      showNotification(
        err.response?.data?.detail || err.response?.data?.error || err.response?.data?.notes || t('notifications.statusUpdateFailed'),
        'error',
      );
    }
  };

  const openCompleteAndPay = async (saleId) => {
    if (!saleId) return;
    try {
      const res = await api.get(`/sales/${saleId}/`);
      setCompletePaySale(res.data);
    } catch (e) {
      console.error(e);
      showNotification(e.response?.data?.detail || e.response?.data?.error || t('notifications.loadSaleFailed'), 'error');
    }
  };

  const renderSaleActionsCell = (sale) => {
    if (!sale) return null;
    if (
      isDispatcherRole &&
      sale.status === 'completed' &&
      sale.delivery_customer_paid_at
    ) {
      return (
        <span style={{ fontSize: '0.82rem', color: '#059669', lineHeight: 1.3 }}>
          {t('deliverySettlement.rowSaleCompleted', { ns: 'sales' })}
        </span>
      );
    }
    if (!saleReadyToComplete(sale) || !canShowCompleteActions) return null;
    if (shopDeliverySettlementRequired(sale)) {
      return (
        <ShopDeliverySettlementButtons sale={sale} onOpenSettlement={openCompleteAndPay} />
      );
    }
    if (isDispatcherRole) return null;
    return (
      <button
        type="button"
        className="btn-status"
        onClick={() => openCompleteAndPay(sale.id)}
      >
        {t('rowActions.completePay', { ns: 'sales' })}
      </button>
    );
  };

  const detailDeliveriesCostTotals = useMemo(() => {
    const rows = dispatcherDetail?.dispatches || [];
    let uzs = 0;
    let usd = 0;
    for (const row of rows) {
      uzs += parseFloat(row.delivery_cost_uzs) || 0;
      usd += parseFloat(row.delivery_cost) || 0;
    }
    return { uzs, usd };
  }, [dispatcherDetail]);

  const btsFromApi = useMemo(() => dispatchers.find((d) => d.is_bts_channel), [dispatchers]);
  const partnersWithoutBts = useMemo(() => dispatchers.filter((d) => !d.is_bts_channel), [dispatchers]);

  const partnerSort = useClientTableSort(PARTNER_DISPATCHER_SORT_ACCESSORS);
  const sortedPartnersWithoutBts = useMemo(
    () => partnerSort.sortRows(partnersWithoutBts || []),
    [partnersWithoutBts, partnerSort],
  );

  const shipmentSort = useClientTableSort(DISPATCH_SHIPMENT_SORT_ACCESSORS);
  const sortedDetailDispatches = useMemo(
    () => shipmentSort.sortRows(dispatcherDetail?.dispatches || []),
    [dispatcherDetail?.dispatches, shipmentSort],
  );

  const allDeliveriesSort = useClientTableSort(ALL_DELIVERIES_SORT_ACCESSORS);
  const sortedAllDeliveriesRows = useMemo(() => {
    const base = [...(dispatches || [])];
    if (!allDeliveriesSort.sortCol) {
      base.sort((a, b) => {
        const oa = DISPATCH_OPEN_STATUSES.has(a.status) ? 0 : 1;
        const ob = DISPATCH_OPEN_STATUSES.has(b.status) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        const ua = new Date(a.updated_at || a.dispatch_date).getTime() || 0;
        const ub = new Date(b.updated_at || b.dispatch_date).getTime() || 0;
        return ub - ua;
      });
      return base;
    }
    return allDeliveriesSort.sortRows(base);
  }, [dispatches, allDeliveriesSort]);

  const statusTimelineSort = useClientTableSort(STATUS_TIMELINE_SORT_ACCESSORS);
  const sortedStatusChangeLogs = useMemo(
    () => statusTimelineSort.sortRows(dispatcherDetail?.status_change_logs || []),
    [dispatcherDetail?.status_change_logs, statusTimelineSort],
  );

  if (loading && dispatches.length === 0) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      {notification.show && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: '8px',
            backgroundColor:
              notification.type === 'success' ? '#4caf50' : notification.type === 'error' ? '#f44336' : '#2196f3',
            color: 'white',
            maxWidth: 'min(90vw, 400px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          {notification.message}
        </div>
      )}

      {completePaySale && shopDeliverySettlementRequired(completePaySale) && (
        <SaleDeliverySettlementForm
          sale={completePaySale}
          onClose={() => setCompletePaySale(null)}
          onAfterStepRecorded={afterDispatchMutation}
          onSuccess={async () => {
            setCompletePaySale(null);
            await afterDispatchMutation();
          }}
          showNotification={showNotification}
        />
      )}
      {completePaySale && !shopDeliverySettlementRequired(completePaySale) && (
        <SaleCompletePayForm
          sale={completePaySale}
          onClose={() => setCompletePaySale(null)}
          onSuccess={async () => {
            setCompletePaySale(null);
            await afterDispatchMutation();
          }}
          showNotification={showNotification}
        />
      )}

      <div className="page-header">
        <PageTitle ns="dispatchers" titleKey={isDispatcherRole ? 'myDeliveries' : 'title'} />
      </div>

      {!isDispatcherRole && (
        <p style={{ color: '#666', marginBottom: 16, fontSize: '0.95em' }}>
          {t('intro')}
        </p>
      )}

      {showForm && canManagePartners && formData.id && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>{t('form.editTitle')}</h2>
          <form onSubmit={handleDispatcherSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('form.name')} *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('form.telephone')} *</label>
                <input
                  type="text"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>
                  {t('form.notes')}{' '}
                  <span style={{ fontWeight: 400, color: '#718096' }}>({t('optional', { ns: 'common' })})</span>
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />{' '}
                  {t('form.active')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.save', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {!isDispatcherRole && (
        <>
        <div className="table-card" style={{ flex: selectedDispatcher ? '0 0 42%' : '1', minWidth: 0 }}>
          <h2>{t('partners.title')}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="name" sortCol={partnerSort.sortCol} sortDir={partnerSort.sortDir} onSort={partnerSort.onHeaderClick}>{t('partners.columns.name')}</SortableTh>
                <SortableTh columnId="login" sortCol={partnerSort.sortCol} sortDir={partnerSort.sortDir} onSort={partnerSort.onHeaderClick}>{t('partners.columns.login')}</SortableTh>
                <SortableTh columnId="telephone" sortCol={partnerSort.sortCol} sortDir={partnerSort.sortDir} onSort={partnerSort.onHeaderClick}>{t('partners.columns.phone')}</SortableTh>
                <SortableTh columnId="loads" sortCol={partnerSort.sortCol} sortDir={partnerSort.sortDir} onSort={partnerSort.onHeaderClick}>{t('partners.columns.loads')}</SortableTh>
                <SortableTh columnId="active" sortCol={partnerSort.sortCol} sortDir={partnerSort.sortDir} onSort={partnerSort.onHeaderClick}>{t('partners.columns.active')}</SortableTh>
                <th onClick={(e) => e.stopPropagation()}>{t('partners.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {btsFromApi ? (
                <tr
                  key={`bts-${btsFromApi.id}`}
                  onClick={() => handleRowSelect(btsFromApi)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor:
                      selectedDispatcher?.isBts && selectedDispatcher?.id === btsFromApi.id
                        ? '#e8f5e9'
                        : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      selectedDispatcher?.isBts && selectedDispatcher?.id === btsFromApi.id
                        ? '#e8f5e9'
                        : '#f1f8e9';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      selectedDispatcher?.isBts && selectedDispatcher?.id === btsFromApi.id
                        ? '#e8f5e9'
                        : 'transparent';
                  }}
                >
                  <td>
                    <strong>{btsFromApi.name || t('serviceTypes.bts')}</strong>{' '}
                    <span style={{ fontSize: '0.85em', color: '#666', fontWeight: 400 }}>{t('partners.btsCompany')}</span>
                  </td>
                  <td>—</td>
                  <td>{btsFromApi.telephone || '—'}</td>
                  <td>{btsLoadCount != null ? btsLoadCount : '—'}</td>
                  <td>{btsFromApi.is_active ? t('yes', { ns: 'common' }) : t('no', { ns: 'common' })}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn-edit" onClick={() => handleEditDispatcher(btsFromApi)}>
                      {t('actions.edit', { ns: 'common' })}
                    </button>{' '}
                    <button type="button" className="btn-delete" onClick={() => handleDeleteDispatcher(btsFromApi.id)}>
                      {t('actions.delete', { ns: 'common' })}
                    </button>
                  </td>
                </tr>
              ) : (
                <tr
                  key="bts-synthetic"
                  onClick={handleSyntheticBtsRowSelect}
                  style={{
                    cursor: 'pointer',
                    backgroundColor:
                      selectedDispatcher?.synthetic && selectedDispatcher?.isBts ? '#e8f5e9' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      selectedDispatcher?.synthetic && selectedDispatcher?.isBts ? '#e8f5e9' : '#f1f8e9';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      selectedDispatcher?.synthetic && selectedDispatcher?.isBts ? '#e8f5e9' : 'transparent';
                  }}
                >
                  <td>
                    <strong>{t('serviceTypes.bts')}</strong>{' '}
                    <span style={{ fontSize: '0.85em', color: '#666', fontWeight: 400 }}>{t('partners.btsRowRemoved')}</span>
                  </td>
                  <td>—</td>
                  <td>—</td>
                  <td>{btsLoadCount != null ? btsLoadCount : '—'}</td>
                  <td>—</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canManagePartners ? (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleRestoreBtsPartner}
                        style={{ fontSize: '0.9em' }}
                      >
                        {t('partners.restoreBts')}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )}
              {partnersWithoutBts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center' }}>
                    {btsFromApi
                      ? t('partners.noPartnersWithBts')
                      : t('partners.noPartnersNoBts')}
                  </td>
                </tr>
              ) : (
                sortedPartnersWithoutBts.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => handleRowSelect(d)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor:
                        !selectedDispatcher?.isBts && selectedDispatcher?.id === d.id ? '#e3f2fd' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (selectedDispatcher?.id !== d.id || selectedDispatcher?.isBts) {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedDispatcher?.id !== d.id || selectedDispatcher?.isBts) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <td>
                      <strong>{d.name}</strong>
                    </td>
                    <td>{d.login_username || '—'}</td>
                    <td>{d.telephone || '—'}</td>
                    <td>{d.dispatch_count != null ? d.dispatch_count : '—'}</td>
                    <td>{d.is_active ? t('yes', { ns: 'common' }) : t('no', { ns: 'common' })}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {d.user ? (
                        <span style={{ color: '#888', fontSize: '0.9em' }}>{t('partners.usersTab')}</span>
                      ) : (
                        <>
                          <button type="button" className="btn-edit" onClick={() => handleEditDispatcher(d)}>
                            {t('actions.edit', { ns: 'common' })}
                          </button>{' '}
                          <button type="button" className="btn-delete" onClick={() => handleDeleteDispatcher(d.id)}>
                            {t('actions.delete', { ns: 'common' })}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedDispatcher && (
          <div className="table-card" style={{ flex: '1', minWidth: 0 }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>
                {selectedDispatcher.isBts
                  ? t('detail.btsTitle')
                  : t('detail.assignmentsTitle', { name: selectedDispatcher.name })}
              </h2>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setSelectedDispatcher(null);
                  setDispatcherDetail(null);
                }}
              >
                {t('actions.close', { ns: 'common' })}
              </button>
            </div>

            {detailLoading && <p>{t('actions.loading', { ns: 'common' })}</p>}

            {!detailLoading && dispatcherDetail && (
              <>
                <div className="form-card" style={{ marginBottom: '16px', backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0 }}>{t('detail.contact')}</h3>
                  <p style={{ margin: '4px 0' }}>
                    <strong>{t('detail.phone')}</strong> {dispatcherDetail.dispatcher.telephone || '—'}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>{t('detail.notes')}</strong> {dispatcherDetail.dispatcher.notes || '—'}
                  </p>
                </div>

                <div className="form-card" style={{ marginBottom: '16px', backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0 }}>{t('detail.summary')}</h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <strong>{t('detail.totalLoads')}</strong>
                      <div>{dispatcherDetail.summary.total_dispatches}</div>
                    </div>
                    <div>
                      <strong>{t('detail.deliveryCostUzs')}</strong>
                      <div>
                        {formatAppNumber(dispatcherDetail.summary.total_delivery_cost_uzs || 0)} {uzsLabel}
                      </div>
                    </div>
                    <div>
                      <strong>{t('detail.deliveryCostUsd')}</strong>
                      <div>${parseFloat(dispatcherDetail.summary.total_delivery_cost_usd || 0).toFixed(2)}</div>
                    </div>
                    {Object.entries(dispatcherDetail.summary.by_dispatch_status || {})
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => (
                        <div key={k}>
                          <strong>{tStatus(k, 'dispatch')}</strong>
                          <div>{v}</div>
                        </div>
                      ))}
                  </div>
                </div>

                <h3 style={{ marginBottom: '8px' }}>{t('detail.shipments')}</h3>
                <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <SortableTh columnId="sale_id" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.sale')}</SortableTh>
                        <SortableTh columnId="product" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.product')}</SortableTh>
                        <SortableTh columnId="customer" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.customer')}</SortableTh>
                        <SortableTh columnId="sale_status" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.saleStatus')}</SortableTh>
                        <SortableTh columnId="dispatch_date" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.dispatchDate')}</SortableTh>
                        <SortableTh columnId="dispatch_type_key" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.type')}</SortableTh>
                        <SortableTh columnId="delivery_cost_key" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.deliveryCost')}</SortableTh>
                        <SortableTh columnId="is_paid" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.paid')}</SortableTh>
                        <SortableTh columnId="delivered_at" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.delivered')}</SortableTh>
                        <SortableTh columnId="tracking_number" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.tracking')}</SortableTh>
                        <SortableTh columnId="logistics_notes" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.notes')}</SortableTh>
                        <SortableTh columnId="status" sortCol={shipmentSort.sortCol} sortDir={shipmentSort.sortDir} onSort={shipmentSort.onHeaderClick}>{t('shipments.columns.dispatchStatus')}</SortableTh>
                        <th>{t('shipments.columns.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDetailDispatches.length === 0 ? (
                        <tr>
                          <td colSpan={13} style={{ textAlign: 'center' }}>
                            {t('detail.noDispatches')}
                          </td>
                        </tr>
                      ) : (
                        sortedDetailDispatches.map((row) => {
                          const sale = row.sale_detail;
                          return (
                            <tr key={row.id}>
                              <td>#{sale?.id}</td>
                              <td style={{ minWidth: '140px' }}>{productLine(sale)}</td>
                              <td>{sale?.customer_detail?.name || '—'}</td>
                              <td>
                                <span className={`status-badge ${sale?.status || ''}`}>{sale?.status ? tStatus(sale.status, 'sale') : '—'}</span>
                              </td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                {row.dispatch_date ? formatAppDateTime(row.dispatch_date) : '—'}
                              </td>
                              <td>{dispatchTypeLabel(row.dispatch_type)}</td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: '0.9rem' }}>{formatCost(row, uzsLabel)}</td>
                              <td>{row.is_paid ? t('yes', { ns: 'common' }) : t('no', { ns: 'common' })}</td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                {row.delivered_at ? formatAppDateTime(row.delivered_at) : '—'}
                              </td>
                              <td>{row.tracking_number || '—'}</td>
                              <td>
                                <LogisticsNotesCell
                                  dispatchId={row.id}
                                  initial={row.logistics_notes || ''}
                                  onSave={(notes) => patchDispatch(row.id, { logistics_notes: notes })}
                                />
                              </td>
                              <td>
                                <select
                                  value={row.status}
                                  onChange={(e) => applyDispatchRowStatusChange(row, e.target.value)}
                                >
                                  {statusOptionsRow.map((s) => (
                                    <option key={s.value} value={s.value}>
                                      {s.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                {renderSaleActionsCell(sale)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'right' }}>
                          {t('detail.total')}
                        </td>
                        <td style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                          {detailDeliveriesCostTotals.uzs > 0 || detailDeliveriesCostTotals.usd > 0
                            ? [
                                detailDeliveriesCostTotals.uzs > 0
                                  ? `${formatAppNumber(detailDeliveriesCostTotals.uzs)} ${uzsLabel}`
                                  : null,
                                detailDeliveriesCostTotals.usd > 0
                                  ? `$${detailDeliveriesCostTotals.usd.toFixed(2)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : '—'}
                        </td>
                        <td colSpan="5">—</td>
                        <td>—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <h3 style={{ marginBottom: '8px' }}>{t('detail.timeline')}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <SortableTh columnId="timestamp" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.time')}</SortableTh>
                        <SortableTh columnId="dispatch_num" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.dispatchNum')}</SortableTh>
                        <SortableTh columnId="previous_status" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.from')}</SortableTh>
                        <SortableTh columnId="new_status" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.to')}</SortableTh>
                        <SortableTh columnId="changed_by" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.by')}</SortableTh>
                        <SortableTh columnId="notes" sortCol={statusTimelineSort.sortCol} sortDir={statusTimelineSort.sortDir} onSort={statusTimelineSort.onHeaderClick}>{t('timeline.columns.notes')}</SortableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {!dispatcherDetail.status_change_logs?.length ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center' }}>
                            {t('detail.noStatusChanges')}
                          </td>
                        </tr>
                      ) : (
                        sortedStatusChangeLogs.map((log) => (
                          <tr key={log.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                              {log.timestamp ? formatAppDateTime(log.timestamp) : '—'}
                            </td>
                            <td>#{log.object_id}</td>
                            <td>{log.previous_status ? tStatus(log.previous_status, 'dispatch') : '—'}</td>
                            <td>{tStatus(log.new_status, 'dispatch')}</td>
                            <td>{log.changed_by_detail?.username || '—'}</td>
                            <td>{log.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
        </>
        )}
      </div>

      <div className="table-card" style={{ marginTop: isDispatcherRole ? 0 : '24px' }}>
        <h2>{isDispatcherRole ? t('workspace.assignedDeliveries') : t('workspace.allDeliveries')}</h2>
        <div className="filter-toolbar filter-toolbar--tight filter-toolbar--bleed">
          <div className="filter-field">
            <label>{t('filters.status')}</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              {dispatchStatusOptions.map((s) => (
                <option key={s.value || 'all'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.service')}</label>
            <select
              value={filters.serviceType}
              onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })}
            >
              <option value="">{t('filters.all', { ns: 'common' })}</option>
              <option value="bts">{t('serviceTypes.bts')}</option>
              <option value="dostavshik">{t('serviceTypes.dostavshik')}</option>
            </select>
          </div>
          {!isDispatcherRole && (
          <div className="filter-field">
            <label>{t('filters.dispatcher')}</label>
            <select
              value={filters.dispatcher}
              onChange={(e) => setFilters({ ...filters, dispatcher: e.target.value })}
            >
              <option value="">{t('filters.all', { ns: 'common' })}</option>
              {activeDispatchers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="id" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('table.id', { ns: 'common' })}</SortableTh>
                <SortableTh columnId="sale_id" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.sale')}</SortableTh>
                <SortableTh columnId="product" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.product')}</SortableTh>
                <SortableTh columnId="customer" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.customer')}</SortableTh>
                <SortableTh columnId="dispatch_type_key" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.type')}</SortableTh>
                <SortableTh columnId="delivery_cost_key" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.deliveryCost')}</SortableTh>
                <SortableTh columnId="dispatcher_name" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('filters.dispatcher')}</SortableTh>
                <SortableTh columnId="delivered_at" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.delivered')}</SortableTh>
                <SortableTh columnId="logistics_notes" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('shipments.columns.notes')}</SortableTh>
                <SortableTh columnId="status" sortCol={allDeliveriesSort.sortCol} sortDir={allDeliveriesSort.sortDir} onSort={allDeliveriesSort.onHeaderClick}>{t('table.status', { ns: 'common' })}</SortableTh>
                <th>{t('table.actions', { ns: 'common' })}</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center' }}>
                    {t('workspace.noMatch')}
                  </td>
                </tr>
              ) : (
                sortedAllDeliveriesRows.map((row) => {
                  const sale = row.sale_detail;
                  return (
                    <tr key={row.id}>
                      <td>#{row.id}</td>
                      <td>#{sale?.id}</td>
                      <td>{productLine(sale)}</td>
                      <td>{sale?.customer_detail?.name || '—'}</td>
                      <td>{dispatchTypeLabel(row.dispatch_type)}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.9rem' }}>{formatCost(row, uzsLabel)}</td>
                      <td>
                        {canManagePartners ? (
                        <FormSearchableSelect
                          value={row.dispatcher ? String(row.dispatcher) : ''}
                          onChange={(v) => {
                            patchDispatch(row.id, { dispatcher: v ? parseInt(v, 10) : null });
                          }}
                          options={activeDispatchers.map((d) => ({ value: String(d.id), label: d.name }))}
                          emptyLabel={t('workspace.unassigned')}
                          placeholder={t('workspace.unassigned')}
                          aria-label={t('workspace.dispatcher')}
                        />
                        ) : (
                          row.dispatcher_detail?.name || '—'
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.9em' }}>
                        {row.delivered_at ? formatAppDateTime(row.delivered_at) : '—'}
                      </td>
                      <td>
                        <LogisticsNotesCell
                          dispatchId={row.id}
                          initial={row.logistics_notes || ''}
                          onSave={(notes) => patchDispatch(row.id, { logistics_notes: notes })}
                        />
                      </td>
                      <td>
                        <select
                          value={row.status}
                          onChange={(e) => applyDispatchRowStatusChange(row, e.target.value)}
                        >
                          {statusOptionsRow.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{renderSaleActionsCell(sale)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="5" style={{ textAlign: 'right' }}>
                  {t('workspace.totalFiltered')}
                </td>
                <td style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                  {allDeliveriesCostTotals.uzs > 0 || allDeliveriesCostTotals.usd > 0
                    ? [
                        allDeliveriesCostTotals.uzs > 0
                          ? `${formatAppNumber(allDeliveriesCostTotals.uzs)} ${uzsLabel}`
                          : null,
                        allDeliveriesCostTotals.usd > 0
                          ? `$${allDeliveriesCostTotals.usd.toFixed(2)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : '—'}
                </td>
                <td colSpan="4">—</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

function LogisticsNotesCell({ dispatchId, initial, onSave }) {
  const { t } = useAppTranslation(['dispatchers', 'common']);
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(initial);
    setDirty(false);
  }, [dispatchId, initial]);

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
      <textarea
        rows={2}
        style={{ minWidth: '140px', maxWidth: '200px' }}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
      />
      {dirty && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            if (!String(value).trim()) {
              alert(t('notifications.logisticsNotesRequired'));
              return;
            }
            onSave(String(value).trim());
            setDirty(false);
          }}
        >
          {t('actions.save', { ns: 'common' })}
        </button>
      )}
    </div>
  );
}

export default Dispatchers;
