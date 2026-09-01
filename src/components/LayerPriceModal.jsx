import React, { useEffect, useState } from 'react';

import Modal from './Modal';
import BusyForm, { SubmitButton } from './BusyForm';
import AmountInput from './AmountInput';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import { layerSellingQuote, formatSellingPrice } from '../utils/inventorySelling';

/**
 * Re-price one shelf line.
 *
 * The dialog names where the current figure comes from, because it is not always this row: a
 * layer with no price of its own shows the stocking order's, or the product's. Saying so is what
 * turns "the price didn't change" into "ah, that one was the order's" — the confusion this whole
 * feature exists to remove.
 *
 * Clearing the box is a real action, not a way out: it drops the layer's own price and lets the
 * row fall back to where it was reading before.
 */
export default function LayerPriceModal({ layer, open, onClose, onSaved }) {
  const { t } = useAppTranslation(['inventory', 'common']);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState(null);

  const quote = layer ? layerSellingQuote(layer) : null;

  useEffect(() => {
    if (!open || !layer) return;
    // Pre-filled with the layer's own price only. A price inherited from the order or the product
    // is shown above as context, not dropped into the box — typing over an inherited figure and
    // saving it unchanged would silently copy it onto the layer.
    setPrice(layer.selling_price != null ? String(layer.selling_price) : '');
    setCurrency((layer.selling_price_currency || quote?.currency || 'USD').toUpperCase());
    setError(null);
  }, [open, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return null;

  const product = layer.product_detail || {};
  const name = [product.brand, product.model].filter(Boolean).join(' | ') || `#${layer.batch_id}`;

  const save = async () => {
    setError(null);
    try {
      await api.post('/inventory/set_layer_price/', {
        batch_id: layer.batch_id,
        selling_price: price === '' ? null : price,
        selling_price_currency: currency,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || t('layerPrice.errSave'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('layerPrice.title', { layer: layer.batch_id })}
      closeLabel={t('actions.close', { ns: 'common' })}
      width={520}
      closeOnBackdrop={false}
    >
      <p className="layer-price__item">
        {name}
        {product.size ? ` · ${product.size}` : ''}
        {product.color ? ` · ${product.color}` : ''}
      </p>

      <p className="layer-price__current">
        {t('layerPrice.currently')}{' '}
        <strong>{formatSellingPrice(quote?.amount, quote?.currency) || '—'}</strong>
        {quote?.source && (
          <span className="layer-price__source">
            {t(`layerPrice.source.${quote.source}`)}
          </span>
        )}
      </p>

      <BusyForm onSubmit={save}>
        <div className="form-grid form-grid--compact">
          <div className="form-group">
            <label htmlFor="layer-price">{t('layerPrice.newPrice')}</label>
            <AmountInput
              id="layer-price"
              placeholder={t('layerPrice.placeholder')}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <small className="label-print__hint">{t('layerPrice.clearHint')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="layer-price-ccy">{t('layerPrice.currency')}</label>
            <select
              id="layer-price-ccy"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </select>
          </div>
        </div>

        <p className="layer-price__note">{t('layerPrice.note')}</p>

        {error && <p className="form-hint-error">{error}</p>}

        <div className="form-actions">
          <SubmitButton className="btn-primary">{t('actions.save', { ns: 'common' })}</SubmitButton>
          <button type="button" className="btn-edit" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
        </div>
      </BusyForm>
    </Modal>
  );
}
