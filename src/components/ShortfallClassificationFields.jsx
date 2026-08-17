import React from 'react';
import AmountInput from './AmountInput';
import { formatDisplayAmount } from '../utils/currencyFormat';

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
 *
 * `allowCredit` opts a call site into the third answer: the customer takes the goods and owes
 * the rest. Opt-in rather than on everywhere, because it is only honest where the caller both
 * sends `credit_due_date` and posts to an endpoint that classifies credit — the courier's own
 * step-1 proposal does neither, and offering it there would promise a debt nothing would open.
 */
export default function ShortfallClassificationFields({ form, setForm, meta, t, allowCredit = false }) {
  const onCredit = !!form.apply_credit;
  // Money over the amount due is a different question with a different pair of answers, and
  // Discount is not one of them — you cannot forgive a surplus. Branching here rather than at
  // each call site is what keeps every form that classifies a difference in step.
  if (isOverpaidMeta(meta)) {
    return <SurplusClassificationFields form={form} setForm={setForm} meta={meta} t={t} />;
  }
  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
        {allowCredit ? t('completePay.shortfallHintCredit') : t('completePay.shortfallHint')}
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
          <AmountInput
            step={meta.sc === 'UZS' ? '1' : '0.01'}
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
      {allowCredit && (
        <>
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}
          >
            <input
              type="checkbox"
              checked={onCredit}
              onChange={(e) => {
                const checked = e.target.checked;
                // Nothing else is touched. Credit sits beside the discount and the conversion
                // difference rather than replacing either — one gap can hold all three.
                setForm((prev) => ({
                  ...prev,
                  apply_credit: checked,
                  credit_amount: checked ? prev.credit_amount || '' : '',
                  credit_due_date: checked ? prev.credit_due_date || '' : '',
                }));
              }}
            />
            <span>{t('completePay.creditOption')}</span>
          </label>
          {onCredit && (
            <div style={{ marginTop: 10, maxWidth: 280 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                {t('completePay.creditAmountLabel', { currency: meta.sc || 'USD' })}
              </label>
              <AmountInput
                step={(meta.sc || 'USD').toUpperCase() === 'UZS' ? '1' : '0.01'}
                placeholder={
                  meta.creditAmount != null
                    ? ((meta.sc || 'USD').toUpperCase() === 'UZS'
                      ? String(Math.round(meta.creditAmount))
                      : Number(meta.creditAmount).toFixed(2))
                    : '0'
                }
                value={form.credit_amount ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, credit_amount: e.target.value }))}
              />
              <small style={{ color: '#666', marginTop: 5, display: 'block' }}>
                {t('completePay.creditAmountHint')}
              </small>
              <label
                style={{ display: 'block', marginTop: 10, marginBottom: 4, fontSize: '0.9em' }}
              >
                {t('completePay.creditDueDateLabel')}
              </label>
              <input
                type="date"
                value={form.credit_due_date ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, credit_due_date: e.target.value }))}
                required
              />
              <small style={{ color: '#666', marginTop: 5, display: 'block' }}>
                {t('completePay.creditDueDateHint')}
              </small>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** True when a payment-difference meta reflects a genuine underpayment (not overpayment/exact). */
export function isUnderpaidMeta(meta) {
  if (!meta || meta.short == null || Number.isNaN(meta.short)) return false;
  const tol = (meta.sc || 'USD').toUpperCase() === 'UZS' ? 1 : 0.005;
  return meta.short > tol;
}

/** The mirror of `isUnderpaidMeta`: money came in above the amount due. */
export function isOverpaidMeta(meta) {
  if (!meta || meta.short == null || Number.isNaN(meta.short)) return false;
  const tol = (meta.sc || 'USD').toUpperCase() === 'UZS' ? 1 : 0.005;
  return meta.short < -tol;
}

/**
 * The same choice as above, for money that came in **over** the amount due.
 *
 * Discount has no meaning here — you cannot forgive a surplus — so the pair is different: the
 * money is either a conversion difference (change handed back at a rate that did not divide
 * evenly, which is where most small surpluses come from) or profit the shop genuinely kept.
 * Without this, over-collecting had no classification at all and the only way to absorb it was
 * to raise the sale's price, which reports the surplus as something the goods sold for.
 */
export function SurplusClassificationFields({ form, setForm, meta, t }) {
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const wantFx = !!form.apply_currency_conversion_difference;
  const wantProfit = !!form.apply_additional_profit;
  const sc = (meta?.sc || 'USD').toUpperCase();
  const surplus = meta?.short != null ? Math.abs(meta.short) : 0;
  // Only the conversion difference carries an amount, and only once profit is also taking a
  // share — on its own it absorbs the whole surplus and a box would just be a second way to
  // say the same number, which is how the two could disagree.
  const showAmount = wantFx && wantProfit;

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
        {t('completePay.surplusHint')}
      </p>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={wantFx}
          onChange={(e) =>
            set({
              apply_currency_conversion_difference: e.target.checked,
              ...(e.target.checked ? {} : { currency_conversion_difference_amount: '' }),
            })
          }
        />
        <span>{t('completePay.conversionDifferenceOption')}</span>
      </label>
      {showAmount && (
        <div style={{ marginTop: 10, maxWidth: 280 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
            {t('completePay.conversionDifferenceAmountLabel', { currency: sc })}
          </label>
          <AmountInput
            step={sc === 'UZS' ? '1' : '0.01'}
            value={form.currency_conversion_difference_amount ?? ''}
            onChange={(e) =>
              set({ currency_conversion_difference_amount: e.target.value })
            }
          />
          <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
            {t('completePay.conversionDifferenceRemainder', {
              amount: formatDisplayAmount(
                Math.max(
                  0,
                  surplus - (parseFloat(form.currency_conversion_difference_amount) || 0),
                ),
                sc,
              ),
            })}
          </small>
        </div>
      )}
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
          checked={wantProfit}
          onChange={(e) => set({ apply_additional_profit: e.target.checked })}
        />
        <span>{t('completePay.additionalProfitOption')}</span>
      </label>
    </>
  );
}
