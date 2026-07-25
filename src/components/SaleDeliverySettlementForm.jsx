import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import useCbuExchangeRate from '../hooks/useCbuExchangeRate';
import { formatDisplayAmount } from '../utils/currencyFormat';
import {
  buildPaymentFormDataFromSale,
  deliveryStep2PaymentFromStep1,
  computeAdvanceRemainingDue,
  computePaymentDifferenceMeta,
  emptyPaymentFormState,
  paymentNeedsCbuConversion,
  shopDeliverySettlementActiveStep,
  lineIsDeclinedPending,
} from '../utils/saleCompletePayHelpers';
import {
  runSalePaymentSubmitFlow,
  combinedPaymentInSaleCurrency,
} from '../utils/salePaymentFlowHelpers';
import { buildCombinedSaleForGroup } from '../utils/saleGroupDisplay';

function PaymentDueNote({ meta, t }) {
  if (meta.due == null || Number.isNaN(meta.due)) return null;
  return (
    <p style={{ margin: '4px 0 0', fontSize: '0.9em', color: '#444' }}>
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
    </p>
  );
}

function DeliveryPaymentAmountFields({ form, setForm, meta, t, disabled = false, hideDue = false }) {
  return (
    <>
      <div className="form-group">
        <label>{t('currency.uzs', { ns: 'common' })}</label>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          disabled={disabled}
          value={form.uzs ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, uzs: e.target.value }))}
        />
      </div>
      <div className="form-group">
        <label>{t('currency.usd', { ns: 'common' })}</label>
        <input
          type="text"
          inputMode="decimal"
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
  const [step3Combined, setStep3Combined] = useState({ uzs: '', usd: '' });
  const cardRef = useRef(null);
  const initedIdsRef = useRef(new Set());
  const step2InitedIdsRef = useRef(new Set());
  const combinedStep2InitedRef = useRef(false);
  const combinedStep3InitedRef = useRef(false);
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
    step2InitedIdsRef.current = new Set();
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

  // Step 2 prefill: computed exactly once per line, the moment it actually has step-1-collected
  // data to prefill from (delivery_customer_paid_at just became truthy) — NOT at initial load,
  // when every group line is still fetched up front but most haven't reached step 2 yet.
  useEffect(() => {
    if (linesLoading || !lines.length) return;
    setStep2ByLine((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const line of lines) {
        if (!line.delivery_customer_paid_at) continue;
        if (step2InitedIdsRef.current.has(line.id)) continue;
        const fd = buildPaymentFormDataFromSale(line, cbuRate);
        const step2FromStep1 = deliveryStep2PaymentFromStep1(line);
        next[line.id] = step2FromStep1 ? { ...fd, uzs: step2FromStep1.uzs, usd: step2FromStep1.usd } : fd;
        step2InitedIdsRef.current.add(line.id);
        changed = true;
      }
      return changed ? next : prev;
    });
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
    // Step 2 combining still requires a clean group (no declines) — see showStep2Combined.
    const noneDeclinedNow = lines.every((l) => !l.delivery_customer_declined_at);
    const step2Now = noneDeclinedNow
      ? lines.filter(
          (l) => l.delivery_customer_paid_at && !l.delivery_shop_remittance_at && !l.delivery_customer_declined_at,
        )
      : [];
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
  const noneDeclined = lines.every((l) => !l.delivery_customer_declined_at);
  const showStep2Combined = noneDeclined && step2Lines.length > 1;
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
      toAccept.push({ line, uzsT, usdT });
    }

    for (const { line, uzsT, usdT } of toAccept) {
      const sc = line.sale_currency || 'USD';
      const needsCbuRate =
        (uzsT > 0 && usdT > 0) ||
        (sc === 'USD' && uzsT > 0 && usdT === 0) ||
        (sc === 'UZS' && usdT > 0 && uzsT === 0);
      if (needsCbuRate && !cbuRate) {
        showNotification?.(exchangeRateError || t('completePay.errRateLoading'), 'error');
        return;
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
      for (const { line, uzsT, usdT } of toAccept) {
        const sc = line.sale_currency || 'USD';
        const body = { uzs: uzsT, usd: usdT, sale_currency: sc, item_status: 'accepted' };
        if (exchangeRate?.rate && (uzsT > 0 && usdT > 0)) {
          body.exchange_rate = exchangeRate.rate;
        } else if (exchangeRate?.rate && ((sc === 'USD' && uzsT > 0) || (sc === 'UZS' && usdT > 0))) {
          body.exchange_rate = exchangeRate.rate;
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

  /** POST step 2 for one line. Returns true on success, false/throws on failure. Silent (no
   * notification/reload) so both the per-line and combined-trip submit paths can wrap it. */
  const submitStep2Line = async (line, form, noteOverride) => {
    const flow = await runSalePaymentSubmitFlow({
      sale: line,
      paymentFormData: form,
      exchangeRate,
      exchangeRateError,
      showNotification,
      allowDiscount: true,
    });
    if (!flow.ok) return false;
    const body = { ...flow.requestData };
    const trimmedNote = String(noteOverride ?? step2NoteByLine[line.id] ?? '').trim();
    if (trimmedNote) body.delivery_shop_remittance_note = trimmedNote;
    await api.post(`/sales/${line.id}/delivery_shop_received_payment/`, body);
    return true;
  };

  const handleStep2Submit = async (line) => {
    try {
      const form = step2ByLine[line.id] || emptyPaymentFormState();
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

  /** Step 2, collapsed: one combined UZS/USD amount split proportionally by each line's own due,
   * used when every line in the group was accepted at step 1 (no per-item decline to worry about). */
  /** Step 2, collapsed: resolve the reconciliation ONCE against a synthetic combined sale (clean
   * combined due/paid/excess numbers, one confirm dialog — same pattern SaleCompletePayForm uses
   * for the regular group Complete & Pay), then split the already-resolved flags per line. This
   * avoids each line independently re-detecting its own proportional-split "overpayment" and
   * popping its own confusing, oddly-rounded confirmation. */
  const handleStep2CombinedSubmit = async () => {
    const combinedSale = buildCombinedSaleForGroup(step2Lines);
    if (!combinedSale) return;
    const combinedForm = {
      ...emptyPaymentFormState(),
      uzs: step2Combined.uzs,
      usd: step2Combined.usd,
      balance_shortfall_type: step2Combined.balance_shortfall_type,
      balance_shortfall_amount: step2Combined.balance_shortfall_amount,
      apply_currency_conversion_difference: step2Combined.apply_currency_conversion_difference,
    };
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
      return { line, due: due != null && !Number.isNaN(due) ? due : 0 };
    });
    const totalDue = dueByLine.reduce((s, x) => s + x.due, 0);
    const totalUzs = resolved.uzs || 0;
    const totalUsd = resolved.usd || 0;
    const shortfallTotal = resolved.balance_shortfall_amount || 0;

    let done = 0;
    try {
      for (const { line, due } of dueByLine) {
        const ratio = totalDue > 0 ? due / totalDue : 1 / dueByLine.length;
        const body = {
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
        const trimmedNote = String(step2CombinedNote || '').trim();
        if (trimmedNote) body.delivery_shop_remittance_note = trimmedNote;
        await api.post(`/sales/${line.id}/delivery_shop_received_payment/`, body);
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
                  <div className="form-grid">
                    <div className="form-group">
                      <label>{t('currency.uzs', { ns: 'common' })}</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={step2Combined.uzs}
                        onChange={(e) => setStep2Combined((prev) => ({ ...prev, uzs: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('currency.usd', { ns: 'common' })}</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={step2Combined.usd}
                        onChange={(e) => setStep2Combined((prev) => ({ ...prev, usd: e.target.value }))}
                      />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <p style={{ margin: '0 0 10px', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
                        {t('completePay.shortfallHint')}
                      </p>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={step2Combined.balance_shortfall_type === 'discount'}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setStep2Combined((prev) => ({
                              ...prev,
                              balance_shortfall_type: checked ? 'discount' : '',
                              balance_shortfall_amount: checked ? prev.balance_shortfall_amount : '',
                            }));
                          }}
                        />
                        <span>{t('completePay.discountOption')}</span>
                      </label>
                      {step2Combined.balance_shortfall_type === 'discount' && (
                        <div style={{ marginTop: 10, maxWidth: 280 }}>
                          <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                            {t('completePay.discountAmountLabel', { currency: 'UZS/USD' })}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={step2Combined.balance_shortfall_amount ?? ''}
                            onChange={(e) =>
                              setStep2Combined((prev) => ({ ...prev, balance_shortfall_amount: e.target.value }))
                            }
                          />
                        </div>
                      )}
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
                        <input
                          type="checkbox"
                          checked={!!step2Combined.apply_currency_conversion_difference}
                          onChange={(e) =>
                            setStep2Combined((prev) => ({ ...prev, apply_currency_conversion_difference: e.target.checked }))
                          }
                        />
                        <span>{t('completePay.conversionDifferenceOption')}</span>
                      </label>
                    </div>
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
                const form = step2ByLine[line.id] || emptyPaymentFormState();
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
                    <div className="form-grid">
                      {form.prepayment_amount && parseFloat(form.prepayment_amount) > 0 ? (
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <label>{t('deliverySettlement.prepaymentOnRecord')}</label>
                          <input readOnly style={{ background: '#f5f5f5' }} value={form.prepayment_amount ?? ''} />
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
                                setStep2ByLine((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...prev[line.id],
                                    balance_shortfall_type: checked ? 'discount' : '',
                                    balance_shortfall_amount: checked
                                      ? prev[line.id]?.balance_shortfall_amount || def
                                      : '',
                                  },
                                }));
                              }}
                            />
                            <span>{t('completePay.discountOption')}</span>
                          </label>
                          {form.balance_shortfall_type === 'discount' && (
                            <div style={{ marginTop: 10, maxWidth: 280 }}>
                              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                                {t('completePay.discountAmountLabel', { currency: meta.sc })}
                              </label>
                              <input
                                type="number"
                                step={meta.sc === 'UZS' ? '1' : '0.01'}
                                min="0"
                                value={form.balance_shortfall_amount ?? ''}
                                onChange={(e) =>
                                  setStep2ByLine((prev) => ({
                                    ...prev,
                                    [line.id]: { ...prev[line.id], balance_shortfall_amount: e.target.value },
                                  }))
                                }
                              />
                            </div>
                          )}
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
                            <input
                              type="checkbox"
                              checked={!!form.apply_currency_conversion_difference}
                              onChange={(e) =>
                                setStep2ByLine((prev) => ({
                                  ...prev,
                                  [line.id]: { ...prev[line.id], apply_currency_conversion_difference: e.target.checked },
                                }))
                              }
                            />
                            <span>{t('completePay.conversionDifferenceOption')}</span>
                          </label>
                        </div>
                      )}
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
                  <input
                    type="text"
                    inputMode="decimal"
                    value={step3Combined.uzs}
                    onChange={(e) => setStep3Combined((prev) => ({ ...prev, uzs: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>{t('currency.usd', { ns: 'common' })}</label>
                  <input
                    type="text"
                    inputMode="decimal"
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
                        <input
                          type="text"
                          inputMode="decimal"
                          value={pay.uzs}
                          onChange={(e) =>
                            setStep3PayByLine((prev) => ({ ...prev, [line.id]: { ...prev[line.id], uzs: e.target.value } }))
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('currency.usd', { ns: 'common' })}</label>
                        <input
                          type="text"
                          inputMode="decimal"
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
