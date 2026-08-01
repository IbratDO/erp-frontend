import React from 'react';

/**
 * Discount / currency-difference classification for a payment shortfall.
 *
 * Shared by every place a payment can come in under the amount due: delivery settlement
 * Step 1 (courier proposes when under-collecting), Step 2 per-line and combined (shop
 * reviews), Complete & Pay, and Complete-from-Order. Keeping one implementation is what
 * stops a gap from being silently booked as customer debt on whichever form forgot it.
 *
 * `form` needs `balance_shortfall_type`, `balance_shortfall_amount` and
 * `apply_currency_conversion_difference`; `meta` comes from `computePaymentDifferenceMeta`.
 */
export default function ShortfallClassificationFields({ form, setForm, meta, t }) {
  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
        {t('completePay.shortfallHint')}
      </p>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.balance_shortfall_type === 'discount'}
          onChange={(e) => {
            const checked = e.target.checked;
            const def =
              meta.short > 0
                ? meta.sc === 'UZS'
                  ? String(Math.round(meta.short))
                  : meta.short.toFixed(2)
                : '';
            setForm((prev) => ({
              ...prev,
              balance_shortfall_type: checked ? 'discount' : '',
              balance_shortfall_amount: checked ? prev.balance_shortfall_amount || def : '',
            }));
          }}
        />
        <span>{t('completePay.discountOption')}</span>
      </label>
      {form.balance_shortfall_type === 'discount' && (
        <div style={{ marginTop: 10, maxWidth: 280 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
            {t('completePay.discountAmountLabel', { currency: meta.sc || 'UZS/USD' })}
          </label>
          <input
            type="number"
            step={meta.sc === 'UZS' ? '1' : '0.01'}
            min="0"
            value={form.balance_shortfall_amount ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, balance_shortfall_amount: e.target.value }))}
          />
        </div>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
        <input
          type="checkbox"
          checked={!!form.apply_currency_conversion_difference}
          onChange={(e) => setForm((prev) => ({ ...prev, apply_currency_conversion_difference: e.target.checked }))}
        />
        <span>{t('completePay.conversionDifferenceOption')}</span>
      </label>
    </>
  );
}

/** True when a payment-difference meta reflects a genuine underpayment (not overpayment/exact). */
export function isUnderpaidMeta(meta) {
  if (!meta || meta.short == null || Number.isNaN(meta.short)) return false;
  const tol = (meta.sc || 'USD').toUpperCase() === 'UZS' ? 1 : 0.005;
  return meta.short > tol;
}
