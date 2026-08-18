import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import './TablePage.css';
import BusyForm, { SubmitButton } from '../components/BusyForm';

const ChangePassword = () => {
  const { t } = useTranslation('common');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError(t('auth.changePasswordCurrentRequired'));
      return;
    }
    if (!password.trim()) {
      setError(t('auth.changePasswordRequired'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.changePasswordMismatch'));
      return;
    }

    setSaving(true);
    try {
      await api.post('/users/me/change-password/', {
        current_password: currentPassword,
        password,
        password_confirm: confirm,
      });
      setSuccess(t('auth.changePasswordSuccess'));
      setCurrentPassword('');
      setPassword('');
      setConfirm('');
    } catch (err) {
      const data = err.response?.data;
      const msg =
        data?.error ||
        data?.password?.[0] ||
        data?.detail ||
        t('auth.changePasswordFailed');
      setError(typeof msg === 'string' ? msg : t('auth.changePasswordFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('auth.changePasswordTitle')}</h1>
      </div>
      <BusyForm className="form-card" onSubmit={handleSubmit} style={{ maxWidth: 420 }}>
        <div className="form-group">
          <label htmlFor="current-password">{t('auth.currentPassword')}</label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="new-password">{t('auth.newPassword')}</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirm-password">{t('auth.confirmPassword')}</label>
          <input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        {error ? <div className="error-message">{error}</div> : null}
        {success ? (
          <div className="success-message" style={{ color: '#15803d', marginBottom: 12 }}>
            {success}
          </div>
        ) : null}
        <div className="form-actions">
          <SubmitButton className="btn-primary" disabled={saving}>
            {saving ? t('auth.changePasswordSaving') : t('auth.changePasswordSubmit')}
          </SubmitButton>
        </div>
      </BusyForm>
    </div>
  );
};

export default ChangePassword;
