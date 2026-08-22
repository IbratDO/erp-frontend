import React, { useEffect, useRef } from 'react';
import AmountInput from './AmountInput';
import { formatDisplayAmount } from '../utils/currencyFormat';
import { changeAmountInSaleCurrency } from '../utils/saleCompletePayHelpers';

/**
 * "Qaytim" — change handed straight back to the customer.
 *
 * Shared by Complete & Pay and the reserved-sale (Sotish) form. Change is cash out of the
 * drawer, so it may be given in either currency regardless of what the customer paid in, and
 * the readout below is the point of the whole panel: paying in one currency and taking change
 * in the other is exactly where the arithmetic stops being obvious in your head.
 *
 * `required` is the surplus the customer is owed back, in the sale's currency. `form` needs
 * `apply_change`, `change_uzs` and `change_usd`.
 *
 * **The suggested amount follows `required`.** It used to be worked out once, when the box was
 * ticked, and then never again — so correcting the amount the customer handed over left the
 * change stuck on the old figure. $1,000 for a $950 item suggested $50; changing it to $1,500
 * still suggested $50, and the panel then reported the shop as keeping the missing $500 and
 * asked for it to be classified as profit. The number the shop is shown has to describe the
 * numbers currently on the screen.
 */
export default function SaleChangeFields({ form, setForm, sc, required, cbuRate, t }) {
  const currency = (sc || 'USD').toUpperCase();
  const checked = !!form.apply_change;
  const givenInSc = checked
    ? changeAmountInSaleCurrency(form.change_uzs, form.change_usd, currency, cbuRate)
    : 0;
  const hasRequired = required != null && Number.isFinite(required);
  const gap = hasRequired && givenInSc != null ? required - givenInSc : null;
  const tol = currency === 'UZS' ? 1 : 0.005;
  const settled = gap != null && Math.abs(gap) <= tol;

  const defaultChange = () => {
    if (!hasRequired || required <= 0) return { change_uzs: '', change_usd: '' };
    return currency === 'UZS'
      ? { change_uzs: String(Math.round(required)), change_usd: '' }
      : { change_uzs: '', change_usd: required.toFixed(2) };
  };

  // Re-suggest whenever the amount owed back moves, while the box is ticked. Keyed on the
  // rounded figure and not on `required` itself: the surplus is recomputed on every render and
  // arrives carrying binary dust, so comparing the raw floats would rewrite the field on
  // keystrokes that changed nothing.
  const requiredKey = hasRequired && required > 0
    ? (currency === 'UZS' ? String(Math.round(required)) : required.toFixed(2))
    : '';
  const lastApplied = useRef(null);
  useEffect(() => {
    if (!checked) {
      // Cleared so that ticking the box again re-suggests rather than being skipped as
      // "already applied" from a previous tick.
      lastApplied.current = null;
      return;
    }
    if (lastApplied.current === requiredKey) return;
    lastApplied.current = requiredKey;
    setForm((prev) => ({ ...prev, ...defaultChange() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requiredKey is the whole trigger
  }, [checked, requiredKey]);

  return (
    <>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          marginTop: 12,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const on = e.target.checked;
            // Only the flag here — filling the amounts in is the effect's job, so ticking and
            // later correcting the payment both go through one path instead of two that can
            // disagree about what the field should say.
            setForm((prev) =>
              on
                ? { ...prev, apply_change: true }
                : { ...prev, apply_change: false, change_uzs: '', change_usd: '' },
            );
          }}
        />
        <span>{t('completePay.changeOption')}</span>
      </label>

      {checked && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 180, flex: '1 1 180px' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                {t('completePay.changeUzs')}
              </label>
              <AmountInput
                step="1"
                placeholder="0"
                value={form.change_uzs ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, change_uzs: e.target.value }))}
              />
            </div>
            <div style={{ minWidth: 180, flex: '1 1 180px' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                {t('completePay.changeUsd')}
              </label>
              <AmountInput
                step="0.01"
                placeholder="0"
                value={form.change_usd ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, change_usd: e.target.value }))}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              background: '#f8f9fa',
              borderRadius: 6,
              fontSize: '0.85em',
              color: '#444',
              lineHeight: 1.6,
            }}
          >
            <div>
              <strong>{t('completePay.changeRequired')}</strong>{' '}
              {hasRequired ? formatDisplayAmount(Math.max(0, required), currency) : '—'}
            </div>
            <div>
              <strong>{t('completePay.changeGiving')}</strong>{' '}
              {givenInSc == null ? (
                t('completePay.errRateLoading')
              ) : (
                <>
                  {[
                    (parseFloat(form.change_uzs) || 0) > 0
                      ? formatDisplayAmount(parseFloat(form.change_uzs), 'UZS')
                      : null,
                    (parseFloat(form.change_usd) || 0) > 0
                      ? formatDisplayAmount(parseFloat(form.change_usd), 'USD')
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || formatDisplayAmount(0, currency)}
                  {' · '}
                  {t('completePay.changeInSaleCurrency', {
                    amount: formatDisplayAmount(givenInSc, currency),
                  })}
                </>
              )}
            </div>
            {gap != null && !settled && (
              <div style={{ color: gap > 0 ? '#b45309' : '#b91c1c', marginTop: 4 }}>
                {gap > 0
                  ? t('completePay.changeUnder', {
                      amount: formatDisplayAmount(gap, currency),
                    })
                  : t('completePay.changeOver', {
                      amount: formatDisplayAmount(Math.abs(gap), currency),
                    })}
              </div>
            )}
            {settled && (
              <div style={{ color: '#15803d', marginTop: 4 }}>{t('completePay.changeExact')}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
