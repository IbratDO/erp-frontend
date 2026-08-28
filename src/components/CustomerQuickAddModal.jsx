import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import BusyForm, { SubmitButton } from './BusyForm';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';

/**
 * "+ Qo'shish" beside a customer picker — register a customer without leaving the form.
 *
 * A debt, an order and a sale all start the same way: a customer walks in who is not on the list
 * yet. Sending the user to the Mijozlar page to add them means losing whatever they had already
 * typed, so every one of those forms grew the same little dialog.
 *
 * This is that dialog, once. It owns the fields, the two required checks and the POST, and hands
 * the caller back the created customer so the picker can select it — the only part that differs
 * between the pages that use it.
 *
 * Sales and Orders each still carry their own copy from before this existed. They are working and
 * well covered, so they were left alone rather than swept into a refactor nobody asked for; new
 * callers should use this.
 */

const REGION_VALUES = [
  'andijan',
  'bukhara',
  'fergana',
  'jizzakh',
  'kashkadarya',
  'khorezm',
  'namangan',
  'navoi',
  'samarkand',
  'surkhandarya',
  'syrdarya',
  'tashkent_region',
  'karakalpakstan',
  'tashkent_city',
];

const emptyCustomer = () => ({
  name: '',
  telephone: '+998',
  instagram: '',
  region: 'tashkent_city',
});

/**
 * @param {boolean} open
 * @param {() => void} onClose      also called after a successful create
 * @param {(customer) => void} onCreated  the new customer, straight from the server
 * @param {(message, type) => void} showNotification
 */
export default function CustomerQuickAddModal({ open, onClose, onCreated, showNotification }) {
  const { t } = useAppTranslation(['customers', 'common', 'sales']);
  const [form, setForm] = useState(emptyCustomer);

  const regionChoices = useMemo(
    () => REGION_VALUES.map((value) => ({ value, label: t(`regions.${value}`, { ns: 'sales' }) })),
    [t],
  );

  const close = () => {
    setForm(emptyCustomer());
    onClose?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = String(form.name || '').trim();
    const telephone = String(form.telephone || '').trim();
    if (!name) {
      showNotification?.(t('quickAdd.errName', { ns: 'customers' }), 'error');
      return;
    }
    if (!telephone) {
      showNotification?.(t('quickAdd.errPhone', { ns: 'customers' }), 'error');
      return;
    }
    try {
      const response = await api.post('/customers/', { ...form, name, telephone });
      onCreated?.(response.data);
      setForm(emptyCustomer());
      onClose?.();
      showNotification?.(t('quickAdd.created', { ns: 'customers' }), 'success');
    } catch (error) {
      console.error('Error creating customer:', error);
      showNotification?.(
        error.response?.data?.error || t('notifications.saveError', { ns: 'customers' }),
        'error',
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      closeLabel={t('actions.close', { ns: 'common' })}
      closeOnBackdrop={false}
      title={t('form.newTitle', { ns: 'customers' })}
    >
      <BusyForm onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-group">
            <label>{t('name', { ns: 'customers' })} *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('phone', { ns: 'customers' })} *</label>
            <input
              type="text"
              value={form.telephone}
              onChange={(e) => setForm({ ...form, telephone: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('instagram', { ns: 'customers' })}</label>
            <input
              type="text"
              value={form.instagram}
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>{t('region', { ns: 'customers' })}</label>
            <select
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            >
              {regionChoices.map((region) => (
                <option key={region.value} value={region.value}>
                  {region.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <SubmitButton className="btn-primary">
            {t('addCustomer', { ns: 'customers' })}
          </SubmitButton>
          <button type="button" className="btn-edit" onClick={close}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
        </div>
      </BusyForm>
    </Modal>
  );
}
