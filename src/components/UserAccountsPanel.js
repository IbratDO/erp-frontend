import React, { useState, useEffect, useMemo } from 'react';
import api from '../utils/api';
import Modal from './Modal';
import apiGetAll from '../utils/fetchAllPages';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from './PageTitle';
import BusyForm, { SubmitButton } from './BusyForm';
import ActionButton from './ActionButton';

const emptyUser = () => ({
  username: '',
  phone: '+998',
  first_name: '',
  last_name: '',
  role: '',
  password: '',
  is_active: true,
});

/**
 * Manage ERP login accounts. Dispatcher / sales roles sync to Dispatchers & Workers tabs.
 */
const UserAccountsPanel = () => {
  const { t } = useAppTranslation(['users', 'common']);
  const { hasPermission, isAdmin } = usePermissions();
  const canManage = hasPermission('users.manage');
  const canClearData = canManage && isAdmin;
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showClearForm, setShowClearForm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyUser());

  const confirmPhrase = useMemo(() => t('clearDataConfirmPhrase').trim().toUpperCase(), [t]);
  const confirmMatches = clearConfirmText.trim().toUpperCase() === confirmPhrase;
  const showConfirmMismatch = clearConfirmText.length > 0 && !confirmMatches;

  useEffect(() => {
    loadData();
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 5000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        apiGetAll('/users/'),
        apiGetAll('/roles/'),
      ]);
      setUsers(usersRes.data.results || usersRes.data);
      setRoles(rolesRes.data.results || rolesRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const closeUserForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyUser());
  };

  const closeClearForm = () => {
    if (clearing) return;
    setShowClearForm(false);
    setClearConfirmText('');
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(emptyUser());
    setShowClearForm(false);
    setClearConfirmText('');
    setShowForm(true);
  };

  const toggleClearForm = () => {
    if (showClearForm) {
      closeClearForm();
      return;
    }
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyUser());
    setClearConfirmText('');
    setShowClearForm(true);
  };

  const openEdit = (user) => {
    setEditingId(user.id);
    const roleId = user.role ?? user.role_id ?? '';
    setFormData({
      username: user.username,
      phone: user.phone || '+998',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      role: roleId ? String(roleId) : '',
      password: '',
      is_active: user.is_active !== false,
    });
    setShowClearForm(false);
    setClearConfirmText('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const phone = String(formData.phone || '').trim();
    if (!phone || phone === '+998') {
      alert(t('errPhone'));
      return;
    }
    const username = String(formData.username || '').trim();
    if (!username) {
      alert(t('errUsername'));
      return;
    }
    const payload = {
      username,
      phone,
      first_name: String(formData.first_name || '').trim(),
      last_name: String(formData.last_name || '').trim(),
      role: formData.role ? Number(formData.role) : null,
      is_active: formData.is_active,
      email: '',
    };
    if (formData.password) payload.password = formData.password;
    try {
      if (editingId) {
        await api.patch(`/users/${editingId}/`, payload);
      } else {
        if (!formData.password) {
          alert(t('errPasswordNew'));
          return;
        }
        await api.post('/users/', { ...payload, password: formData.password });
      }
      closeUserForm();
      loadData();
    } catch (err) {
      alert(err.response?.data?.detail || JSON.stringify(err.response?.data) || t('errSave'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api.delete(`/users/${id}/`);
      loadData();
    } catch (err) {
      alert(err.response?.data?.detail || t('errDelete'));
    }
  };

  const handleClearDatabase = async (e) => {
    e.preventDefault();
    if (!confirmMatches) return;
    setClearing(true);
    try {
      await api.post('/users/clear-business-data/', { confirm: clearConfirmText.trim().toUpperCase() });
      closeClearForm();
      showNotification(t('clearDataSuccess'), 'success');
      loadData();
    } catch (err) {
      showNotification(
        err.response?.data?.error || err.response?.data?.detail || t('clearDataFailed'),
        'error',
      );
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="users" titleKey="titleFull" />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canManage && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              + {t('newLogin')}
            </button>
          )}
          {canClearData && (
            <button type="button" className="btn-danger-action" onClick={toggleClearForm}>
              {showClearForm ? t('actions.cancel', { ns: 'common' }) : t('clearDataButton')}
            </button>
          )}
        </div>
      </div>

      {notification.show && (
        <div className={`notification-banner ${notification.type}`}>{notification.message}</div>
      )}

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 820 }}>{t('intro')}</p>

      <Modal
        open={showClearForm && canClearData}
        onClose={closeClearForm}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
        className="form-card--danger"
        title={t('clearDataTitle')}
      >
          <div className="danger-callout">
            <div>{t('clearDataWarningIntro')}</div>
            <ul>
              <li>{t('clearDataWarningItem1')}</li>
              <li>{t('clearDataWarningItem2')}</li>
              <li>{t('clearDataWarningItem3')}</li>
            </ul>
            <div className="danger-callout__kept">{t('clearDataWarningKept')}</div>
          </div>
          <BusyForm onSubmit={handleClearDatabase}>
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 320px)' }}>
              <div className="form-group">
                <label>{t('clearDataConfirmLabel')}</label>
                <input
                  type="text"
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  placeholder={t('clearDataConfirmPlaceholder')}
                  autoComplete="off"
                  disabled={clearing}
                  aria-invalid={showConfirmMismatch}
                />
                {showConfirmMismatch && (
                  <span className="form-hint-error">{t('clearDataConfirmMismatch')}</span>
                )}
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton
               
                className="btn-danger-action"
                disabled={clearing || !confirmMatches}
              >
                {clearing ? t('actions.loading', { ns: 'common' }) : t('clearDataProceed')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeClearForm} disabled={clearing}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <Modal
        open={showForm && canManage}
        onClose={closeUserForm}
        title={editingId ? t('editLogin') : t('newLogin')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
      >
          <BusyForm onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('firstName')}</label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  placeholder={t('firstNamePlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('lastName')}</label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('loginUsername')} *</label>
                <input
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>
                  {t('password')} {editingId ? t('passwordKeepBlank') : '*'}
                </label>
                <input
                  type="password"
                  required={!editingId}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label>{t('role')} *</label>
                <select
                  required
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="">{t('selectRole')}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('phoneNumber')} *</label>
                <input
                  type="text"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+998901234567"
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  {t('activeCanLogin')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('actions.save', { ns: 'common' })}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={closeUserForm}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <div className="table-card">
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('colLogin')}</th>
                <th>{t('role')}</th>
                <th>{t('colName')}</th>
                <th>{t('colPhone')}</th>
                <th>{t('colActive')}</th>
                {canManage && <th>{t('table.actions', { ns: 'common' })}</th>}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} style={{ textAlign: 'center' }}>
                    {t('emptyAccounts')}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                    </td>
                    <td>{u.role_name || u.role_code || '—'}</td>
                    <td>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>{u.phone || '—'}</td>
                    <td>{u.is_active !== false ? t('yes', { ns: 'common' }) : t('no', { ns: 'common' })}</td>
                    {canManage && (
                      <td>
                        <button type="button" className="btn-edit" onClick={() => openEdit(u)}>
                          {t('actions.edit', { ns: 'common' })}
                        </button>{' '}
                        <ActionButton type="button" className="btn-delete" onClick={() => handleDelete(u.id)}>
                          {t('actions.delete', { ns: 'common' })}
                        </ActionButton>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UserAccountsPanel;
