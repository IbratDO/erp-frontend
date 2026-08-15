import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import AmountInput from './AmountInput';
import SaleChangeFields from './SaleChangeFields';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import useCbuExchangeRate from '../hooks/useCbuExchangeRate';
import { formatDisplayAmount } from '../utils/currencyFormat';
import {
  buildPaymentFormDataFromSale,
  deliveryStep2PaymentFromStep1,
  computeAdvanceRemainingDue,
  computePaymentDifferenceMeta,
  paymentAmountInSaleCurrency,
  emptyPaymentFormState,
  paymentNeedsCbuConversion,
  shopDeliverySettlementActiveStep,
  lineIsDeclinedPending,
  saleHasOrderAdvance,
  getAdvanceCurrency,
  advanceAmountInSaleCurrency,
} from '../utils/saleCompletePayHelpers';
import {
  runSalePaymentSubmitFlow,
  combinedPaymentInSaleCurrency,
} from '../utils/salePaymentFlowHelpers';
import { buildCombinedSaleForGroup } from '../utils/saleGroupDisplay';
import ShortfallClassificationFields, {
  SurplusClassificationFields,
  isOverpaidMeta,
  isUnderpaidMeta,
} from './ShortfallClassificationFields';

/** Amount-due summary — same gray info-box treatment SaleCompletePayForm uses for its
 * list/discount/final-price/amount-due box, so Complete & Pay and delivery settlement look
 * consistent. */
function PaymentDueNote({ meta, t }) {
  if (meta.due == null || Number.isNaN(meta.due)) return null;
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        background: '#f8f9fa',
        borderRadius: 6,
        fontSize: '0.9em',
        color: '#444',
        lineHeight: 1.5,
      }}
    >
      <strong>{t('deliverySettlement.amountDue')}</strong> {formatDisplayAmount(meta.due, meta.sc)}
      {meta.paid != null ? (
        <>
          {' '}
          ·{' '}
          <strong>
            {meta.splitCurrency || meta.crossCurrency
              ? t('completePay.totalAtCbuIn', { currency: meta.sc })
              : t('completePay.enteredIn', { currency: meta.sc })}
          </strong>{' '}
          {formatDisplayAmount(meta.paid, meta.sc)}
        </>
      ) : meta.mixed ? (
        <span style={{ color: '#b45309' }}> — {t('deliverySettlement.loadingCbu')}</span>
      ) : null}
    </div>
  );
}

function DeliveryPaymentAmountFields({ form, setForm, meta, t, disabled = false, hideDue = false }) {
  return (
    <>
      <div className="form-group">
        <label>{t('currency.uzs', { ns: 'common' })}</label>
        <AmountInput
          placeholder="0"
          disabled={disabled}
          value={form.uzs ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, uzs: e.target.value }))}
        />
      </div>
      <div className="form-group">
        <label>{t('currency.usd', { ns: 'common' })}</label>
        <AmountInput
          placeholder="0"
          disabled={disabled}
          value={form.usd ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, usd: e.target.value }))}
        />
      </div>
      {!hideDue && !disabled && (
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <PaymentDueNote meta={meta} t={t} />
        </div>
      )}
    </>
  );
}

/**
 * The advance already taken against this item, shown to the courier at the door.
 *
 * Without it the courier sees only a figure to collect and no reason for it, which is exactly
 * the situation where he asks the customer for the list price and the customer — who has already
 * paid part of it — argues. The three numbers together answer that on the spot: what the goods
 * cost, what was paid up front, and what is left to hand over.
 *
 * Renders nothing when there is no advance, which is most deliveries.
 */
function AdvanceOnRecordNote({ line, cbuRate, t }) {
  const advanceRaw = parseFloat(line?.advance_payment_received) || 0;
  if (!saleHasOrderAdvance(line) || advanceRaw <= 0) return null;
  const sc = (line.sale_currency || 'USD').toUpperCase();
  const advanceCcy = getAdvanceCurrency(line);
  const advanceInSc = advanceAmountInSaleCurrency(line, cbuRate);
  const total = parseFloat(line.total_amount) || 0;
  const remaining = computeAdvanceRemainingDue(line, null, cbuRate);

  return (
    <div
      style={{
        marginBottom: 10,
        padding: '8px 12px',
        background: '#ecfdf5',
        border: '1px solid #6ee7b7',
        borderRadius: 6,
        fontSize: '0.88em',
        color: '#065f46',
        lineHeight: 1.6,
      }}
    >
      <p style={{ margin: '0 0 2px', fontWeight: 600 }}>
        {t('deliverySettlement.step1AdvanceTitle')}
      </p>
      <div>
        {t('deliverySettlement.step1AdvanceTaken', {
          amount: formatDisplayAmount(advanceRaw, advanceCcy),
        })}
        {advanceCcy !== sc && advanceInSc != null
          ? ` · ${formatDisplayAmount(advanceInSc, sc)}`
          : ''}
      </div>
      <div>{t('deliverySettlement.step1AdvanceListTotal', {
        amount: formatDisplayAmount(total, sc),
      })}</div>
      <div style={{ marginTop: 2, fontWeight: 600 }}>
        {remaining == null
          ? t('deliverySettlement.loadingCbu')
          : t('deliverySettlement.step1AdvanceRemaining', {
              amount: formatDisplayAmount(remaining, sc),
            })}
      </div>
    </div>
  );
}

// Shortfall classification lives in its own component so Complete-from-Order can present the
// same Discount / Conversion-difference choice this form does.

/** Step 2's default form for a line, computed fresh from its current fields every render (no
 * effect/ref timing to get wrong) — prefills the courier's step-1-collected amount and, if they
 * classified a shortfall, pre-checks the matching discount/FX option. Caller merges any of the
 * shop's own edits (stored separately in step2ByLine) on top of this. */
function step2DefaultFormFor(line, cbuRate) {
  const fd = buildPaymentFormDataFromSale(line, cbuRate);
  const step2FromStep1 = deliveryStep2PaymentFromStep1(line);
  const merged = step2FromStep1 ? { ...fd, uzs: step2FromStep1.uzs, usd: step2FromStep1.usd } : fd;
  applyCourierChangeToStep2Form(merged, collectionLegs(line));
  const proposed = line.delivery_step1_shortfall_type;
  const proposedAmount = String(line.delivery_step1_shortfall_amount ?? '');
  if (proposed === 'discount' || proposed === 'discount_and_fx') {
    merged.balance_shortfall_type = 'discount';
    merged.balance_shortfall_amount = proposedAmount;
  }
  if (proposed === 'fx' || proposed === 'discount_and_fx' || proposed === 'fx_and_profit') {
    merged.apply_currency_conversion_difference = true;
  }
  if (proposed === 'additional_profit' || proposed === 'fx_and_profit') {
    merged.apply_additional_profit = true;
  }
  if (proposed === 'fx_and_profit') {
    // Here the stored amount is the conversion share, not a discount.
    merged.currency_conversion_difference_amount = proposedAmount;
  }
  return merged;
}

/** Courier-proposal rollup for the combined Step 2 form — computed fresh at render time from
 * `lines` (no effect/ref), so it never lags behind a reload. */
function combinedShortfallDefault(linesForGroup) {
  let discountSum = 0;
  let fxSum = 0;
  let anyDiscountProposed = false;
  let anyFxProposed = false;
  let anyProfitProposed = false;
  let anySplitProposed = false;
  for (const line of linesForGroup) {
    const proposed = line.delivery_step1_shortfall_type;
    const amount = parseFloat(line.delivery_step1_shortfall_amount) || 0;
    if (proposed === 'discount' || proposed === 'discount_and_fx') {
      anyDiscountProposed = true;
      discountSum += amount;
    }
    if (proposed === 'fx' || proposed === 'discount_and_fx') anyFxProposed = true;
    if (proposed === 'additional_profit') anyProfitProposed = true;
    if (proposed === 'fx_and_profit') {
      anyFxProposed = true;
      anyProfitProposed = true;
      anySplitProposed = true;
      fxSum += amount;
    }
  }
  return {
    balance_shortfall_type: anyDiscountProposed ? 'discount' : '',
    balance_shortfall_amount: anyDiscountProposed ? String(discountSum) : '',
    apply_currency_conversion_difference: anyFxProposed,
    apply_additional_profit: anyProfitProposed,
    // Only carried when a line actually split its surplus; otherwise FX absorbs the whole thing
    // and a named amount would be a second way to say the same number.
    currency_conversion_difference_amount: anySplitProposed ? String(fxSum) : '',
  };
}

/**
 * True when the courier collected more than the price, so there is something to hand back.
 *
 * Reads `requiredChange`, which is measured against the **gross** payment on purpose — it does
 * not shrink to zero the moment change is typed in, so the panel does not vanish underneath
 * someone mid-entry.
 */
function changeIsPossible(meta) {
  if (!meta || meta.requiredChange == null || Number.isNaN(meta.requiredChange)) return false;
  const tol = (meta.sc || 'USD').toUpperCase() === 'UZS' ? 1 : 0.005;
  return meta.requiredChange > tol;
}

/** Amber alert quoting exactly what the courier proposed at Step 1, so the shop can't miss it
 * even though the checkbox/amount below are already pre-filled from the same proposal. */
function CourierShortfallAlert({ line, cbuRate, t }) {
  if (!line?.delivery_step1_shortfall_type) return null;
  const sc = (line.sale_currency || 'USD').toUpperCase();
  const proposed = line.delivery_step1_shortfall_type;
  // A conversion difference goes either way, and the message used to say "under-collected"
  // regardless — so a courier who brought back *more* than the price was reported as having
  // brought back less. Every other option implies its own direction; only this one has to be
  // measured. Net of his own change, because that is his money and not the customer's payment.
  let fxKey = 'deliverySettlement.step1ShortfallProposedFx';
  if (proposed === 'fx') {
    const legs = collectionLegs(line);
    const kept = paymentAmountInSaleCurrency(
      legs.grossUzs - legs.changeUzs, legs.grossUsd - legs.changeUsd, sc, cbuRate,
    );
    const due = computeAdvanceRemainingDue(line, null, cbuRate);
    const tol = sc === 'UZS' ? 1 : 0.005;
    if (kept != null && due != null && kept - due > tol) {
      fxKey = 'deliverySettlement.step1ShortfallProposedFxOver';
    }
  }
  const key = {
    fx: fxKey,
    fx_and_profit: 'deliverySettlement.step1ShortfallProposedFxOver',
    additional_profit: 'deliverySettlement.step1ShortfallProposedProfit',
  }[proposed] || 'deliverySettlement.step1ShortfallProposedDiscount';
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '10px 12px',
        background: '#fffbeb',
        border: '1px solid #fcd34d',
        borderRadius: 6,
        fontSize: '0.88em',
        color: '#92400e',
      }}
    >
      {t(key, {
        product: productLabelFor(line, t),
        amount: formatDisplayAmount(parseFloat(line.delivery_step1_shortfall_amount) || 0, sc),
      })}
    </div>
  );
}

/**
 * What the courier reported at the door, restated at Step 2 before the shop takes his money.
 *
 * The two amount boxes below prefill themselves from this, which is not the same as showing it:
 * a shop counting cash needs to know the gross is the courier's to hand over, that part of it was
 * his own money, and that the difference comes back to him afterwards. Without that, `$150` in a
 * box against a `$145` item reads as an error, and the money he fronted goes unnoticed until it
 * turns up in Kreditorlik with nothing explaining it.
 */
function collectionLegs(line) {
  return {
    grossUzs: parseFloat(line?.delivery_customer_collected_uzs) || 0,
    grossUsd: parseFloat(line?.delivery_customer_collected_usd) || 0,
    changeUzs: parseFloat(line?.delivery_change_given_uzs) || 0,
    changeUsd: parseFloat(line?.delivery_change_given_usd) || 0,
  };
}

/**
 * Put the courier's door-side change into a Step 2 form's change fields, purely so the payment
 * arithmetic sees it.
 *
 * The shop is taking the **gross** the courier collected, and part of it is money he fronted out
 * of his own pocket. `_validate_and_set_sale_completion_shortfall` nets exactly this off before
 * classifying, so a form that does not is measuring a different number than the server: a $100
 * collection with $15 handed back against an $85 item read as $15 of surplus looking for a
 * home, and the advance cap rejected the remittance outright.
 *
 * Only the measurement uses these — `stripFormChangeLegs` takes them off the request, because
 * the server derives the same pair from the sale itself and must not be told twice.
 */
function applyCourierChangeToStep2Form(form, legs) {
  if (!legs || (legs.changeUzs <= 0 && legs.changeUsd <= 0)) return form;
  form.apply_change = true;
  form.change_uzs = legs.changeUzs > 0 ? String(legs.changeUzs) : '';
  form.change_usd = legs.changeUsd > 0 ? String(legs.changeUsd) : '';
  return form;
}

/** The whole trip's door-side change, for the collapsed group form. */
function courierChangeTotals(linesForGroup) {
  let changeUzs = 0;
  let changeUsd = 0;
  for (const line of linesForGroup || []) {
    const legs = collectionLegs(line);
    changeUzs += legs.changeUzs;
    changeUsd += legs.changeUsd;
  }
  return { changeUzs, changeUsd };
}

/** Drop the measurement-only change legs before posting. See `applyCourierChangeToStep2Form`. */
function stripFormChangeLegs(body) {
  const { apply_change: _a, change_uzs: _u, change_usd: _d, ...rest } = body;
  return rest;
}

function legsLabel(uzs, usd) {
  return (
    [
      uzs > 0 ? formatDisplayAmount(uzs, 'UZS') : null,
      usd > 0 ? formatDisplayAmount(usd, 'USD') : null,
    ]
      .filter(Boolean)
      .join(' + ') || '—'
  );
}

/**
 * One trip, itemised: what the courier collected against each thing he carried.
 *
 * The shop is about to take a single sum for the whole group, and the question it has to answer
 * before doing so is *"which of these does that money cover?"* — a stack of identical cards
 * saying only an amount cannot answer it, because nothing on them says which item is which. So
 * this is a table keyed by the product, totalled at the bottom against the amount boxes.
 */
function GroupCollectionSummary({ lines, t }) {
  const rows = lines.map((line) => ({ line, ...collectionLegs(line) }));
  if (!rows.some((r) => r.grossUzs > 0 || r.grossUsd > 0)) return null;

  const total = rows.reduce(
    (acc, r) => ({
      grossUzs: acc.grossUzs + r.grossUzs,
      grossUsd: acc.grossUsd + r.grossUsd,
      changeUzs: acc.changeUzs + r.changeUzs,
      changeUsd: acc.changeUsd + r.changeUsd,
    }),
    { grossUzs: 0, grossUsd: 0, changeUzs: 0, changeUsd: 0 },
  );
  const anyChange = total.changeUzs > 0 || total.changeUsd > 0;

  return (
    <div
      style={{
        marginBottom: 12,
        border: '1px solid #bae6fd',
        borderRadius: 6,
        background: '#f0f9ff',
        overflowX: 'auto',
      }}
    >
      <p style={{ margin: 0, padding: '10px 12px 6px', fontWeight: 600, color: '#075985' }}>
        {t('deliverySettlement.step2CollectionTitle')}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
        <thead>
          <tr style={{ color: '#075985', textAlign: 'left' }}>
            <th style={{ padding: '4px 12px', fontWeight: 500 }}>
              {t('deliverySettlement.step2ItemColumn')}
            </th>
            <th style={{ padding: '4px 12px', fontWeight: 500, textAlign: 'right' }}>
              {t('deliverySettlement.step2CollectedColumn')}
            </th>
            {anyChange && (
              <th style={{ padding: '4px 12px', fontWeight: 500, textAlign: 'right' }}>
                {t('deliverySettlement.step2ChangeColumn')}
              </th>
            )}
          </tr>
        </thead>
        <tbody style={{ color: '#075985', fontVariantNumeric: 'tabular-nums' }}>
          {rows.map((r) => (
            <tr key={r.line.id} style={{ borderTop: '1px solid #bae6fd' }}>
              <td style={{ padding: '6px 12px' }}>{productLabelFor(r.line, t)}</td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {legsLabel(r.grossUzs, r.grossUsd)}
              </td>
              {anyChange && (
                <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                  {legsLabel(r.changeUzs, r.changeUsd)}
                </td>
              )}
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid #7dd3fc', fontWeight: 600 }}>
            <td style={{ padding: '6px 12px' }}>{t('deliverySettlement.step2TotalRow')}</td>
            <td style={{ padding: '6px 12px', textAlign: 'right' }}>
              {legsLabel(total.grossUzs, total.grossUsd)}
            </td>
            {anyChange && (
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {legsLabel(total.changeUzs, total.changeUsd)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
      {anyChange && (
        <p style={{ margin: 0, padding: '6px 12px 10px', color: '#075985' }}>
          {t('deliverySettlement.step2ChangeOwedBack', {
            amount: legsLabel(total.changeUzs, total.changeUsd),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Hand the courier his change back now, rather than leaving him to chase it in Kreditorlik.
 *
 * Only shown when he actually fronted some. The debt is recorded either way — the payable is
 * written and then settled — so this changes when the money moves, never whether it is recorded.
 */
function ReimburseChangeOption({ lines, checked, onChange, t }) {
  const total = lines.reduce(
    (acc, line) => {
      const legs = collectionLegs(line);
      return { uzs: acc.uzs + legs.changeUzs, usd: acc.usd + legs.changeUsd };
    },
    { uzs: 0, usd: 0 },
  );
  if (total.uzs <= 0 && total.usd <= 0) return null;
  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {t('deliverySettlement.reimburseChangeNow', {
            amount: legsLabel(total.uzs, total.usd),
          })}
        </span>
      </label>
      <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
        {checked
          ? t('deliverySettlement.reimburseChangeNowHint')
          : t('deliverySettlement.reimburseChangeLaterHint')}
      </small>
    </div>
  );
}

function CourierCollectionSummary({ line, t }) {
  const grossUzs = parseFloat(line?.delivery_customer_collected_uzs) || 0;
  const grossUsd = parseFloat(line?.delivery_customer_collected_usd) || 0;
  if (grossUzs <= 0 && grossUsd <= 0) return null;
  const changeUzs = parseFloat(line?.delivery_change_given_uzs) || 0;
  const changeUsd = parseFloat(line?.delivery_change_given_usd) || 0;
  const hasChange = changeUzs > 0 || changeUsd > 0;
  const legs = (uzs, usd) =>
    [
      uzs > 0 ? formatDisplayAmount(uzs, 'UZS') : null,
      usd > 0 ? formatDisplayAmount(usd, 'USD') : null,
    ]
      .filter(Boolean)
      .join(' + ');

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '10px 12px',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 6,
        fontSize: '0.88em',
        color: '#075985',
        lineHeight: 1.6,
      }}
    >
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
        {t('deliverySettlement.step2CollectionTitle')}
      </p>
      <div>
        {t('deliverySettlement.step2CollectedGross', { amount: legs(grossUzs, grossUsd) })}
      </div>
      {hasChange && (
        <>
          <div>
            {t('deliverySettlement.step2CourierOwnChange', {
              amount: legs(changeUzs, changeUsd),
            })}
          </div>
          <div style={{ marginTop: 4, fontWeight: 600 }}>
            {t('deliverySettlement.step2ChangeOwedBack', {
              amount: legs(changeUzs, changeUsd),
            })}
          </div>
        </>
      )}
    </div>
  );
}

function productLabelFor(line, t) {
  return line?.product_detail
    ? [line.product_detail.brand, line.product_detail.model].filter(Boolean).join(' ').trim() ||
      t('deliverySettlement.productFallback')
    : t('deliverySettlement.productFallback');
}

/**
 * Shop delivery settlement: 3 steps with UZS/USD + CBU (same rules as Complete & Pay).
 * Group-aware: when `sale.groupSales` has more than one line, every step operates on ALL
 * still-open lines in the group (not just the first), with a per-item accept/decline control
 * at step 1 and a physical-return confirmation banner for declined-pending lines.
 */
export default function SaleDeliverySettlementForm({
  sale: saleProp,
  onClose,
  onSuccess,
  onAfterStepRecorded,
  showNotification,
}) {
  const { t } = useAppTranslation(['sales', 'common']);
  const { hasAnyPermission, hasPermission } = usePermissions();
  const canShopRemittance = hasPermission('sales.delivery_shop_received');
  const canPayDispatchFee = hasAnyPermission([
    'sales.delivery_pay_dispatch_fee',
    'sales.complete_pay',
  ]);
  const canConfirmReturn = hasPermission('sales.delivery_confirm_return');

  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [step1ByLine, setStep1ByLine] = useState({});
  const [step2ByLine, setStep2ByLine] = useState({});
  const [step2NoteByLine, setStep2NoteByLine] = useState({});
  const [step3PayByLine, setStep3PayByLine] = useState({});
  const [step2Combined, setStep2Combined] = useState({
    uzs: '',
    usd: '',
    balance_shortfall_type: '',
    balance_shortfall_amount: '',
    apply_currency_conversion_difference: false,
  });
  const [step2CombinedNote, setStep2CombinedNote] = useState('');
  // Defaults to on: the courier is at the counter and the money is his. Kreditorlik stays the
  // fallback for the times he has already gone.
  const [reimburseChange, setReimburseChange] = useState(true);
  const [step3Combined, setStep3Combined] = useState({ uzs: '', usd: '' });
  const cardRef = useRef(null);
  const initedIdsRef = useRef(new Set());
  const combinedStep2InitedRef = useRef(false);
  const combinedStep3InitedRef = useRef(false);
  // Once the shop touches the combined form's discount/FX controls, stop overlaying the
  // courier-proposal default — their explicit choice (including unchecking it) wins from then on.
  const combinedShortfallTouchedRef = useRef(false);
  const { exchangeRate, exchangeRateError, cbuRate } = useCbuExchangeRate(!!saleProp?.id);

  const lineIds = saleProp?.groupSales?.length
    ? saleProp.groupSales.map((s) => s.id)
    : saleProp?.id
      ? [saleProp.id]
      : [];
  const lineIdsKey = lineIds.join(',');

  useEffect(() => {
    const timer = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(timer);
  }, [saleProp?.id]);

  const reloadLines = async () => {
    if (!lineIds.length) {
      setLines([]);
      return [];
    }
    try {
      const results = await Promise.all(lineIds.map((id) => api.get(`/sales/${id}/`)));
      const fresh = results.map((r) => r.data);
      setLines(fresh);
      return fresh;
    } catch {
      const fallback = saleProp?.groupSales?.length ? saleProp.groupSales : saleProp ? [saleProp] : [];
      setLines(fallback);
      return fallback;
    }
  };

  const isGroupFullySettled = (freshLines) => {
    const notPaid = freshLines.filter((l) => !l.delivery_customer_paid_at && !l.delivery_customer_declined_at);
    const notRemitted = freshLines.filter(
      (l) => l.delivery_customer_paid_at && !l.delivery_shop_remittance_at && !l.delivery_customer_declined_at,
    );
    const feeOpen = freshLines.filter((l) => l.delivery_shop_remittance_at && !l.delivery_dispatcher_fee_completed_at);
    const pendingReturn = freshLines.filter((l) => lineIsDeclinedPending(l));
    return !notPaid.length && !notRemitted.length && !feeOpen.length && !pendingReturn.length;
  };

  const finishOrContinue = async () => {
    const fresh = await reloadLines();
    if (isGroupFullySettled(fresh || [])) {
      await Promise.resolve(onSuccess?.());
    } else {
      await Promise.resolve(onAfterStepRecorded?.());
    }
  };

  useEffect(() => {
    let cancel = false;
    if (!lineIds.length) {
      setLinesLoading(false);
      return undefined;
    }
    setLinesLoading(true);
    initedIdsRef.current = new Set();
    combinedShortfallTouchedRef.current = false;
    combinedStep2InitedRef.current = false;
    combinedStep3InitedRef.current = false;
    (async () => {
      try {
        const results = await Promise.all(lineIds.map((id) => api.get(`/sales/${id}/`)));
        if (!cancel) setLines(results.map((r) => r.data));
      } catch {
        if (!cancel) setLines(saleProp?.groupSales?.length ? saleProp.groupSales : [saleProp]);
      } finally {
        if (!cancel) setLinesLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineIdsKey snapshots the id set
  }, [lineIdsKey]);

  // Prefill per-line forms once each line's data is available (and again once CBU rate arrives,
  // for lines whose step 1 is still open).
  useEffect(() => {
    if (linesLoading || !lines.length) return;
    setStep1ByLine((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        const alreadyInit = initedIdsRef.current.has(line.id);
        if (alreadyInit && !(cbuRate && !line.delivery_customer_paid_at)) continue;
        const fd = buildPaymentFormDataFromSale(line, cbuRate);
        fd.dispatch_payment_needed = false;
        fd.dispatch_payment_amount = '';
        if (!line.delivery_customer_paid_at && !line.delivery_customer_declined_at) {
          const due = computeAdvanceRemainingDue(line, null, cbuRate);
          const sc = (line.sale_currency || 'USD').toUpperCase();
          if (due != null && due > 0) {
            fd.uzs = sc === 'UZS' ? String(Math.round(due)) : '';
            fd.usd = sc === 'USD' ? due.toFixed(2) : '';
          }
        }
        fd.item_status = prev[line.id]?.item_status || 'accepted';
        next[line.id] = fd;
      }
      return next;
    });
    for (const line of lines) initedIdsRef.current.add(line.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, linesLoading, cbuRate]);

  useEffect(() => {
    if (!lines.length) return;
    setStep3PayByLine((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        const step = shopDeliverySettlementActiveStep(line);
        if (step !== 3) continue;
        if (next[line.id]) continue;
        const d = line.dispatch_info || null;
        const uzFee = d ? parseFloat(d.delivery_cost_uzs ?? 0) || 0 : 0;
        const usFee = d ? parseFloat(d.delivery_cost ?? 0) || 0 : 0;
        const feeCcy = uzFee > 0 ? 'UZS' : 'USD';
        const feeDue = uzFee > 0 ? uzFee : usFee;
        if (!d || feeDue <= 0) {
          next[line.id] = { uzs: '', usd: '' };
        } else if (feeCcy === 'UZS') {
          next[line.id] = { uzs: String(Math.round(feeDue)), usd: '' };
        } else {
          next[line.id] = { uzs: '', usd: String(feeDue.toFixed(2)) };
        }
      }
      return next;
    });
  }, [lines]);

  // Prefill the combined-trip totals (used when every line was accepted) once per-line data is
  // in, so the shop only has to review/adjust one number instead of entering it from scratch.
  useEffect(() => {
    if (!lines.length) return;
    // Refused lines never reach step 2, so filtering them out is all the grouping needs — the
    // survivors are still one trip with one payment. See showStep2Combined.
    const step2Now = lines.filter(
      (l) => l.delivery_customer_paid_at && !l.delivery_shop_remittance_at && !l.delivery_customer_declined_at,
    );
    if (step2Now.length > 1 && !combinedStep2InitedRef.current) {
      // Compute directly from each line's own raw fields (what the courier actually collected at
      // step 1, or the line's own due as a fallback) — not from step2ByLine, whose own prefill
      // effect updates asynchronously and can lag a render behind this one.
      let uzsSum = 0;
      let usdSum = 0;
      for (const line of step2Now) {
        const step2FromStep1 = deliveryStep2PaymentFromStep1(line);
        if (step2FromStep1) {
          uzsSum += parseFloat(step2FromStep1.uzs) || 0;
          usdSum += parseFloat(step2FromStep1.usd) || 0;
        } else {
          const due = computeAdvanceRemainingDue(line, null, cbuRate) || 0;
          if ((line.sale_currency || 'USD').toUpperCase() === 'UZS') uzsSum += due;
          else usdSum += due;
        }
      }
      // Courier-proposal seeding (balance_shortfall_type/amount, apply_currency_conversion_difference)
      // is intentionally NOT done here — it's computed inline at render time (see
      // combinedShortfallDefault below) so it can't lag behind lines updating.
      setStep2Combined((prev) => ({
        ...prev,
        uzs: uzsSum > 0 ? String(Math.round(uzsSum)) : '',
        usd: usdSum > 0 ? usdSum.toFixed(2) : '',
      }));
      combinedStep2InitedRef.current = true;
    }
    const step3Now = lines.filter((l) => l.delivery_shop_remittance_at && !l.delivery_dispatcher_fee_completed_at);
    if (step3Now.length > 1 && !combinedStep3InitedRef.current) {
      let uzsSum = 0;
      let usdSum = 0;
      for (const line of step3Now) {
        const d = line.dispatch_info || null;
        uzsSum += d ? parseFloat(d.delivery_cost_uzs ?? 0) || 0 : 0;
        usdSum += d ? parseFloat(d.delivery_cost ?? 0) || 0 : 0;
      }
      setStep3Combined({
        uzs: uzsSum > 0 ? String(Math.round(uzsSum)) : '',
        usd: usdSum > 0 ? usdSum.toFixed(2) : '',
      });
      combinedStep3InitedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, cbuRate]);

  if (!lines.length && !linesLoading) return null;
  if (linesLoading) return null;

  const step1Lines = lines.filter(
    (l) => !l.delivery_customer_paid_at && !l.delivery_customer_declined_at,
  );
  const step2Lines = lines.filter(
    (l) => l.delivery_customer_paid_at && !l.delivery_shop_remittance_at && !l.delivery_customer_declined_at,
  );
  const step3Lines = lines.filter(
    (l) => l.delivery_shop_remittance_at && !l.delivery_dispatcher_fee_completed_at,
  );
  const pendingReturnLines = lines.filter((l) => lineIsDeclinedPending(l));
  const allDone = !step1Lines.length && !step2Lines.length && !step3Lines.length && !pendingReturnLines.length;
  // One trip, one payment: the shop hands over what the courier collected for the whole group in
  // a single go. A line refused at the door never reaches step 2 at all, so it simply is not in
  // `step2Lines` — it does not make the rest of the group any less of a group, and splitting them
  // into a form each only asks the shop to do the same job several times. Each item's own figures
  // are still shown above the shared amount boxes.
  const showStep2Combined = step2Lines.length > 1;
  // Delivery cost is one real-world trip regardless of per-item accept/decline outcomes — always
  // combine it into one form when more than one line is still pending payment (declined lines
  // never reach step 3 at all, so this naturally already excludes them from the total).
  const showStep3Combined = step3Lines.length > 1;

  const setLineStatus = (lineId, itemStatus) => {
    setStep1ByLine((prev) => ({ ...prev, [lineId]: { ...prev[lineId], item_status: itemStatus } }));
  };

  const handleStep1Submit = async () => {
    const toAccept = [];
    const toDecline = [];
    for (const line of step1Lines) {
      const f = step1ByLine[line.id] || {};
      if (f.item_status === 'declined') {
        toDecline.push(line);
        continue;
      }
      const uzsT = parseFloat(f.uzs) || 0;
      const usdT = parseFloat(f.usd) || 0;
      if (uzsT + usdT === 0) {
        showNotification?.(t('deliverySettlement.errAmountForItem', { product: productLabelFor(line, t) }), 'error');
        return;
      }
      toAccept.push({ line, uzsT, usdT, f });
    }

    for (const { line, uzsT, usdT, f } of toAccept) {
      const sc = line.sale_currency || 'USD';
      const needsCbuRate =
        (uzsT > 0 && usdT > 0) ||
        (sc === 'USD' && uzsT > 0 && usdT === 0) ||
        (sc === 'UZS' && usdT > 0 && uzsT === 0);
      if (needsCbuRate && !cbuRate) {
        showNotification?.(exchangeRateError || t('completePay.errRateLoading'), 'error');
        return;
      }
      const meta = computePaymentDifferenceMeta(line, f, cbuRate);
      if (isUnderpaidMeta(meta)) {
        const wantDiscount = f.balance_shortfall_type === 'discount';
        const wantFx = !!f.apply_currency_conversion_difference;
        if (!wantDiscount && !wantFx) {
          showNotification?.(
            t('deliverySettlement.step1ShortfallRequired', { product: productLabelFor(line, t) }),
            'error',
          );
          return;
        }
        if (wantDiscount && !(parseFloat(f.balance_shortfall_amount) > 0)) {
          showNotification?.(t('completePay.errDiscountAmount'), 'error');
          return;
        }
        // A discount smaller than the gap leaves a remainder nothing accounts for. Letting
        // it through pushes the unexplained money silently into the shop stage, so hold the
        // courier here until the whole difference is classified.
        if (meta.differenceNeedsClassification) {
          const short = Math.abs(meta.remainingAfterDiscount || 0);
          showNotification?.(
            t('deliverySettlement.step1ShortfallIncomplete', {
              product: productLabelFor(line, t),
              amount: formatDisplayAmount(short, sc),
            }),
            'error',
          );
          return;
        }
      } else if (isOverpaidMeta(meta)) {
        const wantFx = !!f.apply_currency_conversion_difference;
        const wantProfit = !!f.apply_additional_profit;
        // Splitting the surplus needs the conversion share named, and it cannot exceed the
        // surplus — the same completeness rule the shortfall side applies to a partial discount.
        if (wantFx && wantProfit && meta.differenceNeedsClassification) {
          showNotification?.(
            t('deliverySettlement.step1SurplusSplitIncomplete', {
              product: productLabelFor(line, t),
              amount: formatDisplayAmount(Math.abs(meta.short || 0), sc),
            }),
            'error',
          );
          return;
        }
        // Leaving both boxes unticked is allowed, but it is not a no-op: the item's price moves
        // to whatever was collected. Doing that silently is how a $145 item quietly became a
        // $145.81 one. Say the new price out loud and make the courier agree to it.
        if (!wantFx && !wantProfit) {
          const surplus = Math.abs(meta.short || 0);
          const ok = window.confirm(
            [
              t('deliverySettlement.step1SurplusConfirm', {
                product: productLabelFor(line, t),
                amount: formatDisplayAmount(surplus, sc),
                before: formatDisplayAmount(parseFloat(line.total_amount) || 0, sc),
                after: formatDisplayAmount((parseFloat(line.total_amount) || 0) + surplus, sc),
              }),
              '',
              t('deliverySettlement.step1SurplusConfirmHint'),
            ].join('\n'),
          );
          if (!ok) return;
        }
      }
    }

    if (toDecline.length) {
      const names = toDecline.map((l) => productLabelFor(l, t)).join(', ');
      const ok = window.confirm(
        [
          t('deliverySettlement.confirmDeclineLines'),
          names,
          '',
          t('deliverySettlement.confirmDeclineWarning'),
        ].join('\n'),
      );
      if (!ok) return;
    }

    let done = 0;
    const total = toAccept.length + toDecline.length;
    try {
      for (const line of toDecline) {
        await api.post(`/sales/${line.id}/delivery_customer_paid/`, { item_status: 'declined' });
        done += 1;
      }
      for (const { line, uzsT, usdT, f } of toAccept) {
        const sc = line.sale_currency || 'USD';
        const body = { uzs: uzsT, usd: usdT, sale_currency: sc, item_status: 'accepted' };
        if (f.apply_change) {
          body.change_uzs = parseFloat(f.change_uzs) || 0;
          body.change_usd = parseFloat(f.change_usd) || 0;
          if (exchangeRate?.rate) body.exchange_rate = exchangeRate.rate;
        }
        if (exchangeRate?.rate && (uzsT > 0 && usdT > 0)) {
          body.exchange_rate = exchangeRate.rate;
        } else if (exchangeRate?.rate && ((sc === 'USD' && uzsT > 0) || (sc === 'UZS' && usdT > 0))) {
          body.exchange_rate = exchangeRate.rate;
        }
        const meta = computePaymentDifferenceMeta(line, f, cbuRate);
        if (isUnderpaidMeta(meta)) {
          if (f.balance_shortfall_type === 'discount') {
            body.balance_shortfall_type = 'discount';
            body.balance_shortfall_amount = parseFloat(f.balance_shortfall_amount) || 0;
          }
          if (f.apply_currency_conversion_difference) {
            body.apply_currency_conversion_difference = true;
          }
        } else if (isOverpaidMeta(meta)) {
          // Optional here, unlike a shortfall: leaving both unticked still means "the courier
          // sold it for more", and the price moves to match. Ticking either keeps the price;
          // ticking both splits the surplus, and the named amount is the conversion share.
          if (f.apply_currency_conversion_difference) {
            body.apply_currency_conversion_difference = true;
            const fxAmt = parseFloat(f.currency_conversion_difference_amount);
            if (f.apply_additional_profit && Number.isFinite(fxAmt) && fxAmt > 0) {
              body.currency_conversion_difference_amount = fxAmt;
            }
          }
          if (f.apply_additional_profit) {
            body.apply_additional_profit = true;
          }
        }
        await api.post(`/sales/${line.id}/delivery_customer_paid/`, body);
        done += 1;
      }
      showNotification?.(
        total > 1 ? t('deliverySettlement.step1SuccessGroup', { count: total }) : t('deliverySettlement.step1Success'),
        'success',
      );
      await finishOrContinue();
    } catch (e) {
      showNotification?.(
        total > 1
          ? t('deliverySettlement.step1PartialErr', {
              done,
              total,
              error: e.response?.data?.error || e.response?.data?.detail || '',
            })
          : e.response?.data?.error || e.response?.data?.detail || t('deliverySettlement.step1Err'),
        'error',
      );
      await reloadLines();
    }
  };

  /** When nothing is left to pay for the dispatch fee (already paid at assignment, or no
   * delivery cost recorded), fold Step 3 into Step 2 automatically — there's nothing left for
   * the shop to enter, so don't make them click through a separate "Complete" screen for it. */
  const maybeAutoCompleteStep3 = async (line) => {
    const { needsFeePayment } = step3FeeInfoFor(line);
    if (!needsFeePayment) {
      await api.post(`/sales/${line.id}/delivery_pay_dispatch_fee/`, {});
    }
  };

  /** True (and shows an error) if the shop's entered amount exceeds what the courier reported
   * collecting for this line — the shop is only remitting what the courier actually took in. */
  const exceedsCourierCollection = (line, uzsT, usdT) => {
    const collectedUzs = parseFloat(line.delivery_customer_collected_uzs) || 0;
    const collectedUsd = parseFloat(line.delivery_customer_collected_usd) || 0;
    if (collectedUzs <= 0 && collectedUsd <= 0) return false;
    if (uzsT > collectedUzs + 1 || usdT > collectedUsd + 0.01) {
      showNotification?.(
        t('deliverySettlement.errExceedsCourierCollection', {
          entered: formatDisplayAmount(uzsT > collectedUzs ? uzsT : usdT, uzsT > collectedUzs ? 'UZS' : 'USD'),
          collected: formatDisplayAmount(
            uzsT > collectedUzs ? collectedUzs : collectedUsd,
            uzsT > collectedUzs ? 'UZS' : 'USD',
          ),
        }),
        'error',
      );
      return true;
    }
    return false;
  };

  /** POST step 2 for one line. Returns true on success, false/throws on failure. Silent (no
   * notification/reload) so both the per-line and combined-trip submit paths can wrap it. */
  const submitStep2Line = async (line, form, noteOverride) => {
    if (exceedsCourierCollection(line, parseFloat(form.uzs) || 0, parseFloat(form.usd) || 0)) return false;
    const flow = await runSalePaymentSubmitFlow({
      sale: line,
      paymentFormData: form,
      exchangeRate,
      exchangeRateError,
      showNotification,
      allowDiscount: true,
    });
    if (!flow.ok) return false;
    const body = stripFormChangeLegs({ ...flow.requestData });
    const trimmedNote = String(noteOverride ?? step2NoteByLine[line.id] ?? '').trim();
    if (trimmedNote) body.delivery_shop_remittance_note = trimmedNote;
    // Harmless on a line with no change: the backend only settles a payable it actually wrote.
    if (reimburseChange) body.reimburse_courier_change = true;
    await api.post(`/sales/${line.id}/delivery_shop_received_payment/`, body);
    await maybeAutoCompleteStep3(line);
    return true;
  };

  const handleStep2Submit = async (line) => {
    try {
      const form = { ...step2DefaultFormFor(line, cbuRate), ...(step2ByLine[line.id] || {}) };
      const ok = await submitStep2Line(line, form);
      if (!ok) return;
      showNotification?.(t('deliverySettlement.step2Success'), 'success');
      await finishOrContinue();
    } catch (err) {
      showNotification?.(
        err.response?.data?.error || err.response?.data?.detail || t('deliverySettlement.step2Err'),
        'error',
      );
    }
  };

  /** Combined form's discount/FX fields, with the courier-proposal rollup overlaid unless the
   * shop has already explicitly touched those controls (see combinedShortfallTouchedRef). */
  const getCombinedShortfallForm = () =>
    combinedShortfallTouchedRef.current
      ? {
          balance_shortfall_type: step2Combined.balance_shortfall_type,
          balance_shortfall_amount: step2Combined.balance_shortfall_amount,
          apply_currency_conversion_difference: step2Combined.apply_currency_conversion_difference,
          apply_additional_profit: step2Combined.apply_additional_profit,
          currency_conversion_difference_amount:
            step2Combined.currency_conversion_difference_amount,
        }
      : combinedShortfallDefault(step2Lines);

  /** Step 2, collapsed: resolve the reconciliation ONCE against a synthetic combined sale (clean
   * combined due/paid/excess numbers, one confirm dialog — same pattern SaleCompletePayForm uses
   * for the regular group Complete & Pay), then split the already-resolved flags per line. This
   * avoids each line independently re-detecting its own proportional-split "overpayment" and
   * popping its own confusing, oddly-rounded confirmation. */
  const handleStep2CombinedSubmit = async () => {
    const combinedSale = buildCombinedSaleForGroup(step2Lines);
    if (!combinedSale) return;
    const enteredUzs = parseFloat(step2Combined.uzs) || 0;
    const enteredUsd = parseFloat(step2Combined.usd) || 0;
    let collectedUzsTotal = 0;
    let collectedUsdTotal = 0;
    for (const line of step2Lines) {
      collectedUzsTotal += parseFloat(line.delivery_customer_collected_uzs) || 0;
      collectedUsdTotal += parseFloat(line.delivery_customer_collected_usd) || 0;
    }
    if (
      (collectedUzsTotal > 0 || collectedUsdTotal > 0) &&
      (enteredUzs > collectedUzsTotal + 1 || enteredUsd > collectedUsdTotal + 0.01)
    ) {
      showNotification?.(
        t('deliverySettlement.errExceedsCourierCollection', {
          entered: formatDisplayAmount(
            enteredUzs > collectedUzsTotal ? enteredUzs : enteredUsd,
            enteredUzs > collectedUzsTotal ? 'UZS' : 'USD',
          ),
          collected: formatDisplayAmount(
            enteredUzs > collectedUzsTotal ? collectedUzsTotal : collectedUsdTotal,
            enteredUzs > collectedUzsTotal ? 'UZS' : 'USD',
          ),
        }),
        'error',
      );
      return;
    }
    const combinedForm = applyCourierChangeToStep2Form(
      {
        ...emptyPaymentFormState(),
        uzs: step2Combined.uzs,
        usd: step2Combined.usd,
        ...getCombinedShortfallForm(),
      },
      courierChangeTotals(step2Lines),
    );
    const flow = await runSalePaymentSubmitFlow({
      sale: combinedSale,
      paymentFormData: combinedForm,
      exchangeRate,
      exchangeRateError,
      showNotification,
      allowDiscount: true,
    });
    if (!flow.ok) return;
    const resolved = flow.requestData;

    const dueByLine = step2Lines.map((line) => {
      const due = computeAdvanceRemainingDue(line, null, cbuRate);
      const legs = collectionLegs(line);
      return {
        line,
        due: due != null && !Number.isNaN(due) ? due : 0,
        collectedUzs: legs.grossUzs,
        collectedUsd: legs.grossUsd,
      };
    });
    const totalDue = dueByLine.reduce((s, x) => s + x.due, 0);
    const totalUzs = resolved.uzs || 0;
    const totalUsd = resolved.usd || 0;
    const shortfallTotal = resolved.balance_shortfall_amount || 0;
    // Each line is capped at what the courier reported collecting *for that line*, so the split
    // has to follow the collection, not the price. They are not proportional the moment he hands
    // change back on one item: a $250 collection against a $240 item makes every other line's
    // share of the group total come out above its own cap, and the shop is told it is remitting
    // more than the courier took when it is remitting exactly what he took. Only fall back to the
    // due ratio for a line with nothing recorded, which is the case that has no cap either.
    const collectedUzsSum = dueByLine.reduce((s, x) => s + x.collectedUzs, 0);
    const collectedUsdSum = dueByLine.reduce((s, x) => s + x.collectedUsd, 0);
    const splitByCollection =
      dueByLine.every((x) => x.collectedUzs > 0 || x.collectedUsd > 0) &&
      Math.abs(collectedUzsSum - totalUzs) <= 1 &&
      Math.abs(collectedUsdSum - totalUsd) <= 0.01;

    let done = 0;
    try {
      for (const { line, due, collectedUzs, collectedUsd } of dueByLine) {
        const ratio = totalDue > 0 ? due / totalDue : 1 / dueByLine.length;
        const body = splitByCollection
          ? { uzs: collectedUzs, usd: collectedUsd }
          : {
              uzs: totalUzs > 0 ? Math.round(totalUzs * ratio * 100) / 100 : 0,
              usd: totalUsd > 0 ? Math.round(totalUsd * ratio * 100) / 100 : 0,
            };
        if (resolved.balance_shortfall_type === 'discount') {
          body.balance_shortfall_type = 'discount';
          body.balance_shortfall_amount = Math.round(shortfallTotal * ratio * 100) / 100;
        }
        if (resolved.apply_currency_conversion_difference) {
          body.apply_currency_conversion_difference = true;
        }
        if (resolved.apply_additional_profit) {
          body.apply_additional_profit = true;
        }
        if (resolved.exchange_rate) body.exchange_rate = resolved.exchange_rate;
        if (reimburseChange) body.reimburse_courier_change = true;
        const trimmedNote = String(step2CombinedNote || '').trim();
        if (trimmedNote) body.delivery_shop_remittance_note = trimmedNote;
        await api.post(`/sales/${line.id}/delivery_shop_received_payment/`, body);
        await maybeAutoCompleteStep3(line);
        done += 1;
      }
      showNotification?.(t('deliverySettlement.step2SuccessGroup', { count: done }), 'success');
      await finishOrContinue();
    } catch (err) {
      showNotification?.(
        done > 0
          ? t('deliverySettlement.step1PartialErr', {
              done,
              total: dueByLine.length,
              error: err.response?.data?.error || err.response?.data?.detail || '',
            })
          : err.response?.data?.error || err.response?.data?.detail || t('deliverySettlement.step2Err'),
        'error',
      );
      await reloadLines();
    }
  };

  const step3FeeInfoFor = (line) => {
    const d = line.dispatch_info || null;
    const uzFee = d ? parseFloat(d.delivery_cost_uzs ?? 0) || 0 : 0;
    const usFee = d ? parseFloat(d.delivery_cost ?? 0) || 0 : 0;
    const feeCcy = uzFee > 0 ? 'UZS' : 'USD';
    const feeDue = uzFee > 0 ? uzFee : usFee;
    const needsFeePayment = !!(d && !d.is_paid && feeDue > 0);
    return { feeCcy, feeDue, needsFeePayment };
  };

  /** POST step 3 for one line, given already-decided uzs/usd amounts and whether the mismatch
   * confirmation was already accepted. No notification/reload — callers wrap those. */
  const postStep3Line = async (line, uzsT, usdT, needsFeePayment, confirmDispatchFee) => {
    const body = {};
    if (needsFeePayment) {
      body.uzs = uzsT;
      body.usd = usdT;
      if (exchangeRate?.rate) body.exchange_rate = exchangeRate.rate;
      if (confirmDispatchFee) body.confirm_dispatch_fee_payment = true;
    }
    await api.post(`/sales/${line.id}/delivery_pay_dispatch_fee/`, body);
  };

  const handleStep3Submit = async (line) => {
    const { feeCcy, feeDue, needsFeePayment } = step3FeeInfoFor(line);
    const pay = step3PayByLine[line.id] || { uzs: '', usd: '' };
    try {
      let confirmDispatchFee = false;
      const uzsT = parseFloat(pay.uzs) || 0;
      const usdT = parseFloat(pay.usd) || 0;
      if (needsFeePayment) {
        if (uzsT + usdT === 0) {
          showNotification?.(t('deliverySettlement.errDispatchFee'), 'error');
          return;
        }
        if ((uzsT > 0 && usdT > 0) || (feeCcy === 'USD' && uzsT > 0) || (feeCcy === 'UZS' && usdT > 0)) {
          if (!cbuRate) {
            showNotification?.(exchangeRateError || t('completePay.errRateLoading'), 'error');
            return;
          }
        }
        const paidTotal = combinedPaymentInSaleCurrency({ sale_currency: feeCcy }, pay.uzs, pay.usd, cbuRate);
        if (paidTotal == null) {
          showNotification?.(t('deliverySettlement.errDispatchCalc'), 'error');
          return;
        }
        const tol = feeCcy === 'UZS' ? 1 : 0.02;
        const isCrossCurrencyOnly =
          (feeCcy === 'UZS' && usdT > 0 && uzsT === 0) || (feeCcy === 'USD' && uzsT > 0 && usdT === 0);
        const amountMismatch = Math.abs(paidTotal - feeDue) > tol;
        if (amountMismatch) {
          const ok = window.confirm(
            [
              t('deliverySettlement.confirmStep3PayTitle'),
              '',
              t('deliverySettlement.confirmStep3PlannedFee', { amount: formatDisplayAmount(feeDue, feeCcy) }),
              t('deliverySettlement.confirmStep3PaymentEntered', { amount: formatDisplayAmount(paidTotal, feeCcy) }),
              t('deliverySettlement.confirmStep3Amounts', { uzs: uzsT.toFixed(2), usd: usdT.toFixed(2) }),
              '',
              t('deliverySettlement.confirmStep3MismatchNote'),
              t('deliverySettlement.confirmStep3Proceed'),
            ].join('\n'),
          );
          if (!ok) return;
          confirmDispatchFee = true;
        } else if (isCrossCurrencyOnly) {
          const ok = window.confirm(
            [
              t('deliverySettlement.confirmStep3FeeTitle'),
              '',
              t('deliverySettlement.confirmStep3FeeOnRecord', { amount: formatDisplayAmount(feeDue, feeCcy) }),
              t('deliverySettlement.confirmStep3FeeAtCbu', { currency: feeCcy, amount: formatDisplayAmount(paidTotal, feeCcy) }),
              t('deliverySettlement.confirmStep3Amounts', { uzs: uzsT.toFixed(2), usd: usdT.toFixed(2) }),
              exchangeRate?.label ? `\n${exchangeRate.label}` : '',
              '',
              t('completePay.confirmContinue'),
            ]
              .filter(Boolean)
              .join('\n'),
          );
          if (!ok) return;
          confirmDispatchFee = true;
        }
      }
      await postStep3Line(line, uzsT, usdT, needsFeePayment, confirmDispatchFee);
      showNotification?.(
        needsFeePayment ? t('deliverySettlement.step3SuccessPay') : t('deliverySettlement.step3Success'),
        'success',
      );
      await finishOrContinue();
    } catch (err) {
      showNotification?.(
        err.response?.data?.error || err.response?.data?.detail || t('deliverySettlement.step3Err'),
        'error',
      );
    }
  };

  /** Step 3, collapsed: one combined fee input (equal to the real one-time trip cost, since 3a
   * now splits the entered delivery cost proportionally across dispatches at creation time) split
   * back across lines by each dispatch's own share, with a single mismatch confirmation if needed. */
  const handleStep3CombinedSubmit = async () => {
    const infos = step3Lines.map((line) => ({ line, ...step3FeeInfoFor(line) }));
    const totalFeeDue = infos.reduce((s, x) => s + (x.needsFeePayment ? x.feeDue : 0), 0);
    const feeCcy = infos.find((x) => x.needsFeePayment)?.feeCcy || 'UZS';
    const uzsT = parseFloat(step3Combined.uzs) || 0;
    const usdT = parseFloat(step3Combined.usd) || 0;
    if (totalFeeDue > 0 && uzsT + usdT === 0) {
      showNotification?.(t('deliverySettlement.errDispatchFee'), 'error');
      return;
    }
    let confirmDispatchFee = false;
    if (totalFeeDue > 0) {
      if ((uzsT > 0 && usdT > 0) || (feeCcy === 'USD' && uzsT > 0) || (feeCcy === 'UZS' && usdT > 0)) {
        if (!cbuRate) {
          showNotification?.(exchangeRateError || t('completePay.errRateLoading'), 'error');
          return;
        }
      }
      const paidTotal = combinedPaymentInSaleCurrency({ sale_currency: feeCcy }, step3Combined.uzs, step3Combined.usd, cbuRate);
      if (paidTotal == null) {
        showNotification?.(t('deliverySettlement.errDispatchCalc'), 'error');
        return;
      }
      const tol = feeCcy === 'UZS' ? 1 : 0.02;
      const amountMismatch = Math.abs(paidTotal - totalFeeDue) > tol;
      const isCrossCurrencyOnly =
        (feeCcy === 'UZS' && usdT > 0 && uzsT === 0) || (feeCcy === 'USD' && uzsT > 0 && usdT === 0);
      let ok = true;
      if (amountMismatch) {
        ok = window.confirm(
          [
            t('deliverySettlement.confirmStep3PayTitle'),
            '',
            t('deliverySettlement.confirmStep3PlannedFee', { amount: formatDisplayAmount(totalFeeDue, feeCcy) }),
            t('deliverySettlement.confirmStep3PaymentEntered', { amount: formatDisplayAmount(paidTotal, feeCcy) }),
            '',
            t('deliverySettlement.confirmStep3MismatchNote'),
            t('deliverySettlement.confirmStep3Proceed'),
          ].join('\n'),
        );
      } else if (isCrossCurrencyOnly) {
        ok = window.confirm(
          [
            t('deliverySettlement.confirmStep3FeeTitle'),
            '',
            t('deliverySettlement.confirmStep3FeeOnRecord', { amount: formatDisplayAmount(totalFeeDue, feeCcy) }),
            t('deliverySettlement.confirmStep3FeeAtCbu', { currency: feeCcy, amount: formatDisplayAmount(paidTotal, feeCcy) }),
            exchangeRate?.label ? `\n${exchangeRate.label}` : '',
            '',
            t('completePay.confirmContinue'),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
      if (!ok) return;
      confirmDispatchFee = amountMismatch || isCrossCurrencyOnly;
    }
    let done = 0;
    try {
      for (const info of infos) {
        const { line, feeDue, needsFeePayment } = info;
        const ratio = totalFeeDue > 0 ? feeDue / totalFeeDue : 1 / infos.length;
        const lineUzs = needsFeePayment && uzsT > 0 ? Math.round(uzsT * ratio * 100) / 100 : 0;
        const lineUsd = needsFeePayment && usdT > 0 ? Math.round(usdT * ratio * 100) / 100 : 0;
        await postStep3Line(line, lineUzs, lineUsd, needsFeePayment, !!confirmDispatchFee);
        done += 1;
      }
      showNotification?.(t('deliverySettlement.step3SuccessGroup', { count: done }), 'success');
      await finishOrContinue();
    } catch (err) {
      showNotification?.(
        done > 0
          ? t('deliverySettlement.step1PartialErr', {
              done,
              total: infos.length,
              error: err.response?.data?.error || err.response?.data?.detail || '',
            })
          : err.response?.data?.error || err.response?.data?.detail || t('deliverySettlement.step3Err'),
        'error',
      );
      await reloadLines();
    }
  };

  const handleConfirmReturn = async (line) => {
    const ok = window.confirm(
      t('deliverySettlement.confirmReturnPrompt', { product: productLabelFor(line, t) }),
    );
    if (!ok) return;
    try {
      await api.post(`/sales/${line.id}/confirm_delivery_return/`, {});
      showNotification?.(t('deliverySettlement.confirmReturnSuccess'), 'success');
      await finishOrContinue();
    } catch (err) {
      showNotification?.(
        err.response?.data?.error || err.response?.data?.detail || t('deliverySettlement.confirmReturnErr'),
        'error',
      );
    }
  };

  return (
    <div ref={cardRef} style={{ marginBottom: 20 }}>
      {allDone ? (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <p style={{ color: '#666', margin: 0, fontSize: '0.9rem' }}>
            {t('deliverySettlement.allDone', { id: saleProp?.id })}
          </p>
        </div>
      ) : null}

      {step1Lines.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>
            {step1Lines.length > 1
              ? t('deliverySettlement.step1GroupTitle', { count: step1Lines.length })
              : t('deliverySettlement.step1Title', { id: step1Lines[0].id })}
          </h2>
          <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em' }}>{t('deliverySettlement.step1Intro')}</p>
          {exchangeRate?.label ? (
            <p style={{ color: '#4a5568', marginBottom: 12, fontSize: '0.85em' }}>{exchangeRate.label}</p>
          ) : exchangeRateError ? (
            <p style={{ color: '#b45309', marginBottom: 12, fontSize: '0.85em' }}>{exchangeRateError}</p>
          ) : null}
          {step1Lines.length > 1 &&
            (() => {
              const totals = step1Lines.reduce(
                (acc, l) => {
                  const f = step1ByLine[l.id] || {};
                  if (f.item_status === 'declined') return acc;
                  return {
                    uzs: acc.uzs + (parseFloat(f.uzs) || 0),
                    usd: acc.usd + (parseFloat(f.usd) || 0),
                  };
                },
                { uzs: 0, usd: 0 },
              );
              return (
                <div
                  className="form-grid"
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                  }}
                >
                  <div className="form-group">
                    <label>{t('deliverySettlement.step1TotalUzsLabel')}</label>
                    <input type="text" readOnly value={formatDisplayAmount(totals.uzs, 'UZS')} />
                  </div>
                  <div className="form-group">
                    <label>{t('deliverySettlement.step1TotalUsdLabel')}</label>
                    <input type="text" readOnly value={formatDisplayAmount(totals.usd, 'USD')} />
                  </div>
                </div>
              );
            })()}
          {step1Lines.map((line) => {
            const form = step1ByLine[line.id] || emptyPaymentFormState();
            const meta = computePaymentDifferenceMeta(line, form, cbuRate);
            const isDeclined = form.item_status === 'declined';
            return (
              <div
                key={line.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.92em' }}>
                  {t('deliverySettlement.step1ItemHeading', {
                    id: line.id,
                    product: productLabelFor(line, t),
                  })}
                </p>
                {!isDeclined && <AdvanceOnRecordNote line={line} cbuRate={cbuRate} t={t} />}
                <div className="settlement-line-row">
                  <DeliveryPaymentAmountFields
                    form={form}
                    setForm={(fn) =>
                      setStep1ByLine((prev) => ({
                        ...prev,
                        [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                      }))
                    }
                    meta={meta}
                    t={t}
                    disabled={isDeclined}
                    hideDue
                  />
                  <div className="form-group">
                    <label>{t('deliverySettlement.itemStatusLabel')}</label>
                    <select value={form.item_status || 'accepted'} onChange={(e) => setLineStatus(line.id, e.target.value)}>
                      <option value="accepted">{t('deliverySettlement.itemStatusAccepted')}</option>
                      <option value="declined">{t('deliverySettlement.itemStatusDeclined')}</option>
                    </select>
                    {isDeclined && (
                      <small style={{ display: 'block', marginTop: 6, color: '#b45309' }}>
                        {t('deliverySettlement.declineHint')}
                      </small>
                    )}
                  </div>
                </div>
                {!isDeclined && <PaymentDueNote meta={meta} t={t} />}
                {/*
                  Qaytim at the door. The courier funds it himself, so the shop takes the whole
                  amount he collected and reimburses this separately — the panel is the counter
                  sale's, because the arithmetic a person has to follow is identical.
                */}
                {/*
                  Only when the customer actually handed over more than the price. Offering it
                  on every delivery invited change out of a payment that had none to give back,
                  and left the option sitting there on the ordinary exact-payment case where it
                  can only ever be a mistake.
                */}
                {!isDeclined && changeIsPossible(meta) && (
                  <SaleChangeFields
                    form={form}
                    setForm={(fn) =>
                      setStep1ByLine((prev) => ({
                        ...prev,
                        [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                      }))
                    }
                    sc={line.sale_currency || 'USD'}
                    required={meta.requiredChange}
                    cbuRate={cbuRate}
                    t={t}
                  />
                )}
                {!isDeclined && isUnderpaidMeta(meta) && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: '0 0 6px', fontSize: '0.88em', color: '#b45309' }}>
                      {t('deliverySettlement.step1ShortfallRequired')}
                    </p>
                    <ShortfallClassificationFields
                      form={form}
                      setForm={(fn) =>
                        setStep1ByLine((prev) => ({
                          ...prev,
                          [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                        }))
                      }
                      meta={meta}
                      t={t}
                    />
                  </div>
                )}
                {/*
                  The mirror case, which used to have nowhere to go: more money came in than the
                  price. Handing back change worth slightly less than was owed lands here, and
                  that surplus is not what the goods sold for.
                */}
                {!isDeclined && isOverpaidMeta(meta) && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: '0 0 6px', fontSize: '0.88em', color: '#b45309' }}>
                      {t('deliverySettlement.step1SurplusOptional')}
                    </p>
                    <SurplusClassificationFields
                      form={form}
                      setForm={(fn) =>
                        setStep1ByLine((prev) => ({
                          ...prev,
                          [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                        }))
                      }
                      t={t}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={handleStep1Submit}>
              {t('deliverySettlement.step1Button')}
            </button>
          </div>
        </div>
      )}

      {pendingReturnLines.length > 0 && (
        <div
          className="form-card"
          style={{ marginBottom: 20, background: '#fffbeb', border: '1px solid #fcd34d' }}
        >
          <h2 style={{ color: '#92400e' }}>{t('deliverySettlement.returnPendingTitle')}</h2>
          <p style={{ color: '#92400e', marginBottom: 16, fontSize: '0.9em' }}>
            {t('deliverySettlement.returnPendingIntro')}
          </p>
          {pendingReturnLines.map((line) => (
            <div
              key={line.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 0',
                borderTop: '1px solid #fde68a',
              }}
            >
              <span style={{ fontSize: '0.9em', color: '#78350f' }}>
                {t('deliverySettlement.returnPendingItem', { id: line.id, product: productLabelFor(line, t), qty: line.quantity })}
              </span>
              {canConfirmReturn ? (
                <button type="button" className="btn-status" onClick={() => handleConfirmReturn(line)}>
                  {t('deliverySettlement.confirmReturnButton')}
                </button>
              ) : (
                <span style={{ fontSize: '0.85em', color: '#92400e' }}>{t('deliverySettlement.returnPendingNoPerm')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {step2Lines.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>
            {step2Lines.length > 1
              ? t('deliverySettlement.step2GroupTitle', { count: step2Lines.length })
              : t('deliverySettlement.step2Title', { id: step2Lines[0].id })}
          </h2>
          {!canShopRemittance ? (
            <p style={{ color: '#666', margin: 0, fontSize: '0.9em', lineHeight: 1.45 }}>
              {t('deliverySettlement.step2NoPerm')}
            </p>
          ) : (
            <>
              <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em' }}>{t('deliverySettlement.step2Intro')}</p>
              {exchangeRate?.label ? (
                <p style={{ color: '#4a5568', marginBottom: 12, fontSize: '0.85em' }}>{exchangeRate.label}</p>
              ) : exchangeRateError ? (
                <p style={{ color: '#b45309', marginBottom: 12, fontSize: '0.85em' }}>{exchangeRateError}</p>
              ) : null}
              {showStep2Combined ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleStep2CombinedSubmit();
                  }}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}
                >
                  <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.92em' }}>
                    {t('deliverySettlement.step2GroupTotalTitle', { count: step2Lines.length })}
                  </p>
                  <GroupCollectionSummary lines={step2Lines} t={t} />
                  {step2Lines
                    .filter((line) => line.delivery_step1_price_before_adjustment != null)
                    .map((line) => (
                      <p key={line.id} style={{ margin: '0 0 10px', fontSize: '0.85em', color: '#b45309' }}>
                        {t('deliverySettlement.step1PriceAdjustedNotice', {
                          product: productLabelFor(line, t),
                          before: formatDisplayAmount(
                            parseFloat(line.delivery_step1_price_before_adjustment) * (parseFloat(line.quantity) || 1),
                            line.sale_currency,
                          ),
                          after: formatDisplayAmount(line.total_amount, line.sale_currency),
                        })}
                      </p>
                    ))}
                  {step2Lines.some((line) => line.delivery_step1_shortfall_type) && (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: '10px 12px',
                        background: '#fffbeb',
                        border: '1px solid #fcd34d',
                        borderRadius: 6,
                        fontSize: '0.88em',
                        color: '#92400e',
                      }}
                    >
                      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
                        {t('deliverySettlement.step1ShortfallProposedRollupTitle')}
                      </p>
                      {step2Lines
                        .filter((line) => line.delivery_step1_shortfall_type)
                        .map((line) => (
                          <p key={line.id} style={{ margin: '2px 0' }}>
                            {t(
                              line.delivery_step1_shortfall_type === 'fx'
                                ? 'deliverySettlement.step1ShortfallProposedFx'
                                : 'deliverySettlement.step1ShortfallProposedDiscount',
                              {
                                product: productLabelFor(line, t),
                                amount: formatDisplayAmount(
                                  parseFloat(line.delivery_step1_shortfall_amount) || 0,
                                  line.sale_currency,
                                ),
                              },
                            )}
                          </p>
                        ))}
                    </div>
                  )}
                  <div className="form-grid">
                    <div className="form-group">
                      <label>{t('currency.uzs', { ns: 'common' })}</label>
                      <AmountInput
                        value={step2Combined.uzs}
                        onChange={(e) => setStep2Combined((prev) => ({ ...prev, uzs: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('currency.usd', { ns: 'common' })}</label>
                      <AmountInput
                        value={step2Combined.usd}
                        onChange={(e) => setStep2Combined((prev) => ({ ...prev, usd: e.target.value }))}
                      />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <ShortfallClassificationFields
                        form={{ ...step2Combined, ...getCombinedShortfallForm() }}
                        setForm={(fn) => {
                          setStep2Combined((prev) => {
                            // Seed with the current overlay defaults on first touch so editing
                            // just the amount (say) doesn't blank out an untouched type/fx choice.
                            const base = combinedShortfallTouchedRef.current
                              ? prev
                              : { ...prev, ...combinedShortfallDefault(step2Lines) };
                            combinedShortfallTouchedRef.current = true;
                            return typeof fn === 'function' ? fn(base) : fn;
                          });
                        }}
                        meta={computePaymentDifferenceMeta(
                          buildCombinedSaleForGroup(step2Lines),
                          applyCourierChangeToStep2Form(
                            { ...step2Combined, ...getCombinedShortfallForm() },
                            courierChangeTotals(step2Lines),
                          ),
                          cbuRate,
                        )}
                        t={t}
                      />
                    </div>
                    <ReimburseChangeOption
                      lines={step2Lines}
                      checked={reimburseChange}
                      onChange={setReimburseChange}
                      t={t}
                    />
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>{t('deliverySettlement.noteOptional')}</label>
                      <textarea
                        rows={2}
                        value={step2CombinedNote}
                        onChange={(e) => setStep2CombinedNote(e.target.value)}
                        placeholder={t('deliverySettlement.notePlaceholder')}
                        style={{ width: '100%', resize: 'vertical', minHeight: 56 }}
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">
                      {t('deliverySettlement.step2Button')}
                    </button>
                  </div>
                </form>
              ) : (
                step2Lines.map((line) => {
                const form = { ...step2DefaultFormFor(line, cbuRate), ...(step2ByLine[line.id] || {}) };
                const meta = computePaymentDifferenceMeta(line, form, cbuRate);
                return (
                  <form
                    key={line.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleStep2Submit(line);
                    }}
                    style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}
                  >
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.92em' }}>
                      {t('deliverySettlement.step1ItemHeading', { id: line.id, product: productLabelFor(line, t) })}
                    </p>
                    <CourierCollectionSummary line={line} t={t} />
                    {line.delivery_step1_price_before_adjustment != null && (
                      <p style={{ margin: '0 0 10px', fontSize: '0.85em', color: '#b45309' }}>
                        {t('deliverySettlement.step1PriceAdjustedNotice', {
                          product: productLabelFor(line, t),
                          before: formatDisplayAmount(
                            parseFloat(line.delivery_step1_price_before_adjustment) * (parseFloat(line.quantity) || 1),
                            line.sale_currency,
                          ),
                          after: formatDisplayAmount(line.total_amount, line.sale_currency),
                        })}
                      </p>
                    )}
                    <div className="form-grid">
                      {form.prepayment_amount && parseFloat(form.prepayment_amount) > 0 ? (
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <label>{t('deliverySettlement.prepaymentOnRecord')}</label>
                          <input
                            readOnly
                            style={{ background: '#f5f5f5' }}
                            value={formatDisplayAmount(
                              parseFloat(form.prepayment_amount) || 0,
                              form.prepayment_currency || line.sale_currency,
                            )}
                          />
                        </div>
                      ) : null}
                      <DeliveryPaymentAmountFields
                        form={form}
                        setForm={(fn) =>
                          setStep2ByLine((prev) => ({
                            ...prev,
                            [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                          }))
                        }
                        meta={meta}
                        t={t}
                      />
                      {meta.needs && (
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <CourierShortfallAlert line={line} cbuRate={cbuRate} t={t} />
                          <ShortfallClassificationFields
                            form={form}
                            setForm={(fn) =>
                              setStep2ByLine((prev) => ({
                                ...prev,
                                [line.id]: typeof fn === 'function' ? fn(prev[line.id] || {}) : fn,
                              }))
                            }
                            meta={meta}
                            t={t}
                          />
                        </div>
                      )}
                      <ReimburseChangeOption
                        lines={[line]}
                        checked={reimburseChange}
                        onChange={setReimburseChange}
                        t={t}
                      />
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>{t('deliverySettlement.noteOptional')}</label>
                        <textarea
                          rows={2}
                          value={step2NoteByLine[line.id] || ''}
                          onChange={(e) => setStep2NoteByLine((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          placeholder={t('deliverySettlement.notePlaceholder')}
                          style={{ width: '100%', resize: 'vertical', minHeight: 56 }}
                        />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button type="submit" className="btn-primary">
                        {t('deliverySettlement.step2Button')}
                      </button>
                    </div>
                  </form>
                );
              })
              )}
            </>
          )}
        </div>
      )}

      {step3Lines.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>{t('deliverySettlement.step3TitlePay', { id: step3Lines[0].id })}</h2>
          {!canPayDispatchFee ? (
            <p style={{ color: '#666', margin: 0, fontSize: '0.9em', lineHeight: 1.45 }}>
              {t('deliverySettlement.step3NoPerm')}
            </p>
          ) : showStep3Combined ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStep3CombinedSubmit();
              }}
              style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}
            >
              <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.92em' }}>
                {t('deliverySettlement.step3GroupTotalTitle', { count: step3Lines.length })}
              </p>
              <div className="form-grid">
                <div className="form-group">
                  <label>{t('currency.uzs', { ns: 'common' })}</label>
                  <AmountInput
                    value={step3Combined.uzs}
                    onChange={(e) => setStep3Combined((prev) => ({ ...prev, uzs: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>{t('currency.usd', { ns: 'common' })}</label>
                  <AmountInput
                    value={step3Combined.usd}
                    onChange={(e) => setStep3Combined((prev) => ({ ...prev, usd: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  {t('deliverySettlement.step3ButtonPay')}
                </button>
              </div>
            </form>
          ) : (
            step3Lines.map((line) => {
              const d = line.dispatch_info || null;
              const uzFee = d ? parseFloat(d.delivery_cost_uzs ?? 0) || 0 : 0;
              const usFee = d ? parseFloat(d.delivery_cost ?? 0) || 0 : 0;
              const feeCcy = uzFee > 0 ? 'UZS' : 'USD';
              const feeDue = uzFee > 0 ? uzFee : usFee;
              const needsFeePayment = !!(d && !d.is_paid && feeDue > 0);
              const pay = step3PayByLine[line.id] || { uzs: '', usd: '' };
              const combinedTotal =
                feeDue > 0
                  ? combinedPaymentInSaleCurrency({ sale_currency: feeCcy }, pay.uzs, pay.usd, cbuRate)
                  : null;
              return (
                <form
                  key={line.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleStep3Submit(line);
                  }}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}
                >
                  <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.92em' }}>
                    {t('deliverySettlement.step1ItemHeading', { id: line.id, product: productLabelFor(line, t) })}
                  </p>
                  {needsFeePayment ? (
                    <div className="form-grid">
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <p style={{ margin: 0, fontSize: '0.9em', color: '#444' }}>
                          <strong>{t('deliverySettlement.dispatchFeeDue')}</strong> {formatDisplayAmount(feeDue, feeCcy)}
                          {combinedTotal != null ? (
                            <>
                              {' '}
                              ·{' '}
                              <strong>
                                {paymentNeedsCbuConversion(pay.uzs, pay.usd, feeCcy)
                                  ? t('completePay.totalAtCbuIn', { currency: feeCcy })
                                  : t('sellReserved.entered', { currency: feeCcy })}
                              </strong>{' '}
                              {formatDisplayAmount(combinedTotal, feeCcy)}
                            </>
                          ) : pay.uzs || pay.usd ? (
                            <span style={{ color: '#b45309' }}> — {t('deliverySettlement.loadingCbu')}</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="form-group">
                        <label>{t('currency.uzs', { ns: 'common' })}</label>
                        <AmountInput
                          value={pay.uzs}
                          onChange={(e) =>
                            setStep3PayByLine((prev) => ({ ...prev, [line.id]: { ...prev[line.id], uzs: e.target.value } }))
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('currency.usd', { ns: 'common' })}</label>
                        <AmountInput
                          value={pay.usd}
                          onChange={(e) =>
                            setStep3PayByLine((prev) => ({ ...prev, [line.id]: { ...prev[line.id], usd: e.target.value } }))
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">
                      {needsFeePayment ? t('deliverySettlement.step3ButtonPay') : t('deliverySettlement.step3ButtonComplete')}
                    </button>
                  </div>
                </form>
              );
            })
          )}
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn-edit" onClick={onClose}>
          {t('actions.close', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
