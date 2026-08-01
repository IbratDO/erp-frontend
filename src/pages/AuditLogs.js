import React, { useState, useEffect, useMemo } from 'react';
import apiGetAll from '../utils/fetchAllPages';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime } from '../utils/localeFormat';
import './TablePage.css';

const STATUS_TYPE_VALUES = ['', 'order', 'inventory_item', 'sale', 'dispatch'];

const ACTION_TYPE_VALUES = [
  '',
  'orders.pay_order',
  'orders.pay_cargo',
  'orders.move_to_inventory',
  'sales.update_status',
  'sales.complete_from_order',
  'returns.mark_refunded',
  'cash.adjust',
];

const AuditLogs = () => {
  const { t, tStatus } = useAppTranslation(['audit', 'common', 'status']);
  const [tab, setTab] = useState('actions');
  const [statusLogs, setStatusLogs] = useState([]);
  const [actionLogs, setActionLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState({ object_type: '', object_id: '' });
  const [actionFilter, setActionFilter] = useState({ action: '', object_type: '', object_id: '' });

  const statusTypeOptions = useMemo(
    () =>
      STATUS_TYPE_VALUES.map((value) => ({
        value,
        label: value ? t(`statusTypes.${value}`) : t('statusTypes.all'),
      })),
    [t],
  );

  const actionTypeOptions = useMemo(
    () =>
      ACTION_TYPE_VALUES.map((value) => ({
        value,
        label: value ? t(`actionTypes.${value}`) : t('actionTypes.all'),
      })),
    [t],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        if (tab === 'status') {
          const params = new URLSearchParams();
          if (statusFilter.object_type) params.append('object_type', statusFilter.object_type);
          if (statusFilter.object_id) params.append('object_id', statusFilter.object_id);
          const url = params.toString() ? `/audit-logs/?${params}` : '/audit-logs/';
          const response = await apiGetAll(url);
          setStatusLogs(response.data.results || response.data);
        } else {
          const params = new URLSearchParams();
          if (actionFilter.action) params.append('action', actionFilter.action);
          if (actionFilter.object_type) params.append('object_type', actionFilter.object_type);
          if (actionFilter.object_id) params.append('object_id', actionFilter.object_id);
          const url = params.toString() ? `/action-audit-logs/?${params}` : '/action-audit-logs/';
          const response = await apiGetAll(url);
          setActionLogs(response.data.results || response.data);
        }
      } catch (error) {
        console.error('Error fetching audit logs:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tab, statusFilter, actionFilter]);

  const formatJson = (value) => {
    if (value == null) return '-';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const statusGroupForObject = (objectType) => {
    if (objectType === 'order') return 'order';
    if (objectType === 'sale') return 'sale';
    if (objectType === 'dispatch') return 'dispatch';
    if (objectType === 'inventory_item') return 'inventory';
    return null;
  };

  const formatStatus = (status, objectType) => {
    if (!status) return '-';
    const group = statusGroupForObject(objectType);
    return group ? tStatus(status, group) : status.replace(/_/g, ' ');
  };

  const formatObjectType = (objectType) => {
    if (!objectType) return '-';
    const key = objectType;
    return t(`statusTypes.${key}`, { defaultValue: objectType.replace(/_/g, ' ') });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="audit" />
      </div>

      <div style={{ marginBottom: 16, gap: 8, display: 'flex' }}>
        <button type="button" className={tab === 'actions' ? 'btn-primary' : 'btn-edit'} onClick={() => setTab('actions')}>
          {t('tabs.actions')}
        </button>
        <button type="button" className={tab === 'status' ? 'btn-primary' : 'btn-edit'} onClick={() => setTab('status')}>
          {t('tabs.status')}
        </button>
      </div>

      {tab === 'actions' ? (
        <>
          <div className="form-card filter-card" style={{ marginBottom: 16 }}>
            <h3 className="filter-card__title">{t('filters.title')}</h3>
            <div className="filter-toolbar">
              <div className="filter-field">
                <label>{t('filters.action')}</label>
                <select value={actionFilter.action} onChange={(e) => setActionFilter({ ...actionFilter, action: e.target.value })}>
                  {actionTypeOptions.map((o) => (
                    <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="filter-field">
                <label>{t('filters.objectType')}</label>
                <input value={actionFilter.object_type} onChange={(e) => setActionFilter({ ...actionFilter, object_type: e.target.value })} placeholder={t('filters.objectTypePlaceholder')} />
              </div>
              <div className="filter-field">
                <label>{t('filters.objectId')}</label>
                <input type="number" value={actionFilter.object_id} onChange={(e) => setActionFilter({ ...actionFilter, object_id: e.target.value })} placeholder={t('filters.objectIdPlaceholder')} />
              </div>
            </div>
          </div>

          <div className="table-card">
            {loading ? <p style={{ padding: 16 }}>{t('actions.loading', { ns: 'common' })}</p> : (
              <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('table.actions.id')}</th>
                      <th>{t('table.actions.action')}</th>
                      <th>{t('table.actions.object')}</th>
                      <th>{t('table.actions.user')}</th>
                      <th>{t('table.actions.timestamp')}</th>
                      <th>{t('table.actions.before')}</th>
                      <th>{t('table.actions.after')}</th>
                      <th>{t('table.actions.notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionLogs.length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: 'center' }}>{t('table.actions.noRows')}</td></tr>
                    ) : actionLogs.map((log) => (
                      <tr key={log.id}>
                        <td>#{log.id}</td>
                        <td><code>{log.action}</code></td>
                        <td>{log.object_type} #{log.object_id}</td>
                        <td>{log.username || '-'}</td>
                        <td>{formatAppDateTime(log.timestamp)}</td>
                        <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatJson(log.before_state)}>{formatJson(log.before_state)}</td>
                        <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatJson(log.after_state)}>{formatJson(log.after_state)}</td>
                        <td>{log.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="form-card filter-card" style={{ marginBottom: 16 }}>
            <h3 className="filter-card__title">{t('filters.title')}</h3>
            <div className="filter-toolbar">
              <div className="filter-field">
                <label>{t('filters.type')}</label>
                <select value={statusFilter.object_type} onChange={(e) => setStatusFilter({ ...statusFilter, object_type: e.target.value })}>
                  {statusTypeOptions.map((o) => (
                    <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="filter-field">
                <label>{t('filters.id')}</label>
                <input type="number" value={statusFilter.object_id} onChange={(e) => setStatusFilter({ ...statusFilter, object_id: e.target.value })} placeholder={t('filters.objectIdStatusPlaceholder')} />
              </div>
            </div>
          </div>

          <div className="table-card">
            {loading ? <p style={{ padding: 16 }}>{t('actions.loading', { ns: 'common' })}</p> : (
              <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('table.status.id')}</th>
                      <th>{t('table.status.objectType')}</th>
                      <th>{t('table.status.objectId')}</th>
                      <th>{t('table.status.previousStatus')}</th>
                      <th>{t('table.status.newStatus')}</th>
                      <th>{t('table.status.changedBy')}</th>
                      <th>{t('table.status.timestamp')}</th>
                      <th>{t('table.status.notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusLogs.length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: 'center' }}>{t('table.status.noRows')}</td></tr>
                    ) : statusLogs.map((log) => (
                      <tr key={log.id}>
                        <td>#{log.id}</td>
                        <td>{formatObjectType(log.object_type)}</td>
                        <td>#{log.object_id}</td>
                        <td>{formatStatus(log.previous_status, log.object_type)}</td>
                        <td><span className={`status-badge ${log.new_status}`}>{formatStatus(log.new_status, log.object_type)}</span></td>
                        <td>{log.changed_by_detail?.username || '-'}</td>
                        <td>{formatAppDateTime(log.timestamp)}</td>
                        <td>{log.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogs;
