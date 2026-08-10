/** Shared logic for "Complete & Pay" (sale status → completed) used from Sales and Dispatchers tabs. */
import i18n from '../i18n';
import { formatDisplayAmount } from './currencyFormat';

/** @param {string} key - key under sales.completePay */
function cp(key, opts) {
  return i18n.t(`completePay.${key}`, { ns: 'sales', ...opts });
}

/** Match backend _validate_and_set_sale_completion_shortfall tolerance (USD sale currency). */
export const PAYMENT_SHORTFALL_TOLERANCE = 0.005;

export function saleHasOrderAdvance(sale) {
  if (!sale) return false;
  const advance = parseFloat(sale.advance_payment_received) || 0;
  return advance > 0 && (sale.sale_type === 'from_order' || sale.order != null);
}

/** Currency in which the customer advance was booked (from linked order when available). */
export function getAdvanceCurrency(sale) {
  const fromApiOrOrder =
    sale?.advance_payment_currency ||
    sale?.order_detail?.advance_payment_currency ||
    (typeof sale?.order === 'object' ? sale?.order?.advance_payment_currency : null);
  const advance = parseFloat(sale?.advance_payment_received) || 0;
  const sc = String(sale?.sale_currency || 'USD').toUpperCase();

  // Large advances on USD sales are almost always UZS (soum), even if currency was stored/sent as USD.
  if (sc === 'USD' && advance >= 1000) return 'UZS';
  if (sc === 'UZS' && advance > 0 && advance < 1000) return 'USD';

  if (fromApiOrOrder) return String(fromApiOrOrder).toUpperCase();
  return sc;
}

/**
 * Order advance expressed in the sale's list currency.
 * Returns null when CBU conversion is required but rate is not available yet.
 */
export function advanceAmountInSaleCurrency(sale, cbuRate) {
  if (!sale) return 0;
  const advance = parseFloat(sale.advance_payment_received) || 0;
  if (advance <= 0) return 0;
  const sc = (sale.sale_currency || 'USD').toUpperCase();
  const ac = getAdvanceCurrency(sale);
  if (ac === sc) return advance;
  if (!cbuRate) return null;
  if (ac === 'UZS' && sc === 'USD') return uzsToUsd(advance, cbuRate);
  if (ac === 'USD' && sc === 'UZS') return usdToUzs(advance, cbuRate);
  return advance;
}

/** Per-unit price customer pays: selling_price minus discount amount. */
export function saleEffectiveUnitPrice(sale) {
  if (!sale) return 0;
  const list = parseFloat(sale.selling_price) || 0;
  const discount = parseFloat(sale.discount_price) || 0;
  return Math.max(0, list - discount);
}

export function saleDiscountAmountPerUnit(sale) {
  if (!sale) return 0;
  const discount = parseFloat(sale.discount_price);
  return Number.isFinite(discount) && discount > 0 ? discount : 0;
}

export function uzsToUsd(uzsAmount, rate) {
  const uzs = parseFloat(uzsAmount) || 0;
  const r = parseFloat(rate);
  if (!uzs || !r || r <= 0) return 0;
  return Math.round((uzs / r) * 100) / 100;
}

export function usdToUzs(usdAmount, rate) {
  const usd = parseFloat(usdAmount) || 0;
  const r = parseFloat(rate);
  if (!usd || !r || r <= 0) return 0;
  return Math.round(usd * r);
}

/** Combined payment in the sale's list currency using CBU rate (UZS per 1 USD). */
export function paymentTotalInSaleCurrency(uzsAmount, usdAmount, saleCurrency, rate) {
  const sc = (saleCurrency || 'USD').toUpperCase();
  const uzs = parseFloat(uzsAmount) || 0;
  const usd = parseFloat(usdAmount) || 0;
  if (sc === 'USD') {
    return Math.round((usd + uzsToUsd(uzs, rate)) * 100) / 100;
  }
  return usdToUzs(usd, rate) + uzs;
}

/** True when UZS/USD legs must be converted via CBU to compare to list currency. */
export function paymentNeedsCbuConversion(uzsAmount, usdAmount, saleCurrency) {
  const sc = (saleCurrency || 'USD').toUpperCase();
  const uzs = parseFloat(uzsAmount) || 0;
  const usd = parseFloat(usdAmount) || 0;
  return (
    (uzs > 0 && usd > 0) ||
    (sc === 'USD' && uzs > 0 && usd === 0) ||
    (sc === 'UZS' && usd > 0 && uzs === 0)
  );
}

/**
 * Payment total in list currency; null when CBU is required but rate is not loaded yet.
 * Matches backend payment_total_in_sale_currency / _payment_amount_in_sale_currency.
 */
export function paymentAmountInSaleCurrency(uzsStr, usdStr, saleCurrency, cbuRate) {
  const uzsT = parseFloat(uzsStr) || 0;
  const usdT = parseFloat(usdStr) || 0;
  if (uzsT <= 0 && usdT <= 0) return null;
  if (paymentNeedsCbuConversion(uzsT, usdT, saleCurrency)) {
    if (!cbuRate) return null;
    return paymentTotalInSaleCurrency(uzsT, usdT, saleCurrency, cbuRate);
  }
  const sc = (saleCurrency || 'USD').toUpperCase();
  return sc === 'USD' ? usdT : uzsT;
}

/**
 * "Qaytim" — change out of the shop's own drawer.
 *
 * Offered wherever the customer settles at the counter: a direct shop sale (single or grouped),
 * a reserved sale being sold, and an on-demand order collected in the shop — including one
 * carrying an advance, whose remaining-due cap simply applies to the net.
 *
 * Not the delivery flow, where the customer pays a courier at their door and the shop is
 * settled days later; the courier gives any change from their own hand and the shop's drawer is
 * never in the room. Mirrors the server's `_sale_accepts_change`, so the option never appears
 * where submitting it would fail.
 */
export function saleAcceptsChange(sale) {
  if (!sale) return false;
  if (sale.sale_type === 'delivery') return false;
  return true;
}

/** Both change legs as one figure in the sale's currency; null when CBU is needed but absent. */
export function changeAmountInSaleCurrency(uzsStr, usdStr, saleCurrency, cbuRate) {
  const uzs = parseFloat(uzsStr) || 0;
  const usd = parseFloat(usdStr) || 0;
  if (uzs <= 0 && usd <= 0) return 0;
  const sc = (saleCurrency || 'USD').toUpperCase();
  const crosses = sc === 'USD' ? uzs > 0 : usd > 0;
  if (crosses && !cbuRate) return null;
  return paymentTotalInSaleCurrency(uzs, usd, sc, cbuRate);
}

function formatAmountForCurrency(amount, currency) {
  const sc = (currency || 'USD').toUpperCase();
  if (sc === 'UZS') {
    return `${Math.round(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS`;
  }
  return `$${amount.toFixed(2)} USD`;
}

export function computeAdvanceRemainingDue(sale, sellingPriceOverride, cbuRate) {
  if (!sale) return 0;
  let total;
  if (sellingPriceOverride != null && sellingPriceOverride !== '') {
    const qty = parseFloat(sale.quantity) || 0;
    total = parseFloat(sellingPriceOverride) * qty;
  } else if (sale.total_amount != null && sale.total_amount !== '') {
    total = parseFloat(sale.total_amount);
  } else {
    const qty = parseFloat(sale.quantity) || 0;
    total = saleEffectiveUnitPrice(sale) * qty;
  }
  const advance = advanceAmountInSaleCurrency(sale, cbuRate);
  if (advance == null) return null;
  return Math.max(0, (Number.isFinite(total) ? total : 0) - advance);
}

export function paymentHasShortfall(due, paid, saleCurrency) {
  const d = parseFloat(due) || 0;
  const p = parseFloat(paid) || 0;
  if ((saleCurrency || 'USD').toUpperCase() === 'UZS') {
    return p + 1 < d;
  }
  return p + PAYMENT_SHORTFALL_TOLERANCE < d;
}

/**
 * `changeInSc` is change handed back, valued in the sale's currency. It comes off before the
 * cap for the same reason the server does it: handing over more than the remaining due and
 * taking the surplus straight back is not an overpayment.
 */
export function validateAdvanceCompletionPayment(
  sale, uzsStr, usdStr, sellingPriceOverride, cbuRate, changeInSc = 0,
) {
  if (!saleHasOrderAdvance(sale)) {
    return { ok: true };
  }
  const due = computeAdvanceRemainingDue(sale, sellingPriceOverride, cbuRate);
  // `cap` is what the raw legs are measured against; `due` stays the real remaining balance so
  // the confirm dialogs below keep quoting the number the customer actually owes.
  const back = parseFloat(changeInSc) || 0;
  const cap = due == null ? null : due + back;
  const sc = (sale.sale_currency || 'USD').toUpperCase();
  const uzsT = parseFloat(uzsStr) || 0;
  const usdT = parseFloat(usdStr) || 0;
  const advCcy = getAdvanceCurrency(sale);
  const needsAdvCbu = advCcy !== sc;

  if (due == null || (needsAdvCbu && !cbuRate)) {
    return { ok: false, error: cp('errRateLoading') };
  }

  if (uzsT > 0 && usdT > 0) {
    if (!cbuRate) {
      return { ok: false, error: cp('errRateLoading') };
    }
    const paid = paymentTotalInSaleCurrency(uzsT, usdT, sc, cbuRate);
    if (paid > cap + 0.005) {
      return {
        ok: false,
        error: cp('errExceedsDueAdvanceCbu', { amount: formatAmountForCurrency(due, sc) }),
      };
    }
    return {
      ok: true,
      needsSplitCurrencyConfirm: true,
      due,
      sc,
      uzsAmount: uzsT,
      usdAmount: usdT,
      paidInSaleCurrency: paid,
      cbuRate,
    };
  }

  if (sc === 'USD') {
    if (usdT > cap + 0.005) {
      return {
        ok: false,
        error: cp('errExceedsDueFormatted', { amount: formatAmountForCurrency(due, sc) }),
      };
    }
    if (uzsT > 0 && usdT === 0) {
      return {
        ok: true,
        needsCrossCurrencyConfirm: true,
        due,
        sc,
        otherCurrency: 'UZS',
        otherAmount: uzsT,
      };
    }
  } else {
    if (uzsT > cap + 0.005) {
      return {
        ok: false,
        error: cp('errExceedsDueFormatted', { amount: formatAmountForCurrency(due, sc) }),
      };
    }
    if (usdT > 0 && uzsT === 0) {
      return {
        ok: true,
        needsCrossCurrencyConfirm: true,
        due,
        sc,
        otherCurrency: 'USD',
        otherAmount: usdT,
      };
    }
  }

  return { ok: true };
}

export function buildCrossCurrencyAdvanceConfirmMessage(validation, exchangeRate) {
  const { due, sc, otherCurrency, otherAmount } = validation;
  const dueLabel = formatAmountForCurrency(due, sc);
  const payLabel = formatAmountForCurrency(otherAmount, otherCurrency);
  const rateLine = exchangeRate?.label
    ? cp('confirmCbuRate', { label: exchangeRate.label })
    : exchangeRate?.rate
      ? cp('confirmCbuRateUsdUzs', {
          rate: Number(exchangeRate.rate).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        })
      : null;
  let equivSuffix = '';
  if (exchangeRate?.rate && otherAmount > 0) {
    if (sc === 'USD' && otherCurrency === 'UZS') {
      equivSuffix = cp('confirmCrossEquiv', {
        amount: formatAmountForCurrency(uzsToUsd(otherAmount, exchangeRate.rate), sc),
      });
    } else if (sc === 'UZS' && otherCurrency === 'USD') {
      equivSuffix = cp('confirmCrossEquiv', {
        amount: formatAmountForCurrency(usdToUzs(otherAmount, exchangeRate.rate), sc),
      });
    }
  }
  return [
    rateLine,
    cp('confirmCrossListed', { sc }),
    cp('confirmCrossRemaining', { sc, due: dueLabel }),
    cp('confirmCrossRecording', { payLabel, otherCurrency, equiv: equivSuffix }),
    cp('confirmContinue'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSplitCurrencyConfirmMessage({
  sale,
  uzsAmount,
  usdAmount,
  due,
  sc,
  cbuRate,
  paidInSaleCurrency,
  exchangeRate,
}) {
  const saleCurrency = (sc || sale?.sale_currency || 'USD').toUpperCase();
  const rateLabel =
    exchangeRate?.label ||
    (cbuRate
      ? cp('confirmCbuRateUsdUzs', {
          rate: Number(cbuRate).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        })
      : null);
  const uzsFormatted = formatAmountForCurrency(uzsAmount, 'UZS');
  const usdFormatted = formatAmountForCurrency(usdAmount, 'USD');
  const uzsLine =
    uzsAmount > 0
      ? saleCurrency === 'USD'
        ? cp('confirmSplitLineUzsWithEquiv', {
            amount: uzsFormatted,
            equiv: formatAmountForCurrency(uzsToUsd(uzsAmount, cbuRate), saleCurrency),
          })
        : cp('confirmSplitLineUzs', { amount: uzsFormatted })
      : null;
  const usdLine =
    usdAmount > 0
      ? saleCurrency === 'UZS'
        ? cp('confirmSplitLineUsdWithEquiv', {
            amount: usdFormatted,
            equiv: formatAmountForCurrency(usdToUzs(usdAmount, cbuRate), saleCurrency),
          })
        : cp('confirmSplitLineUsd', { amount: usdFormatted })
      : null;
  const totalPaid =
    paidInSaleCurrency != null
      ? formatAmountForCurrency(paidInSaleCurrency, saleCurrency)
      : formatAmountForCurrency(
          paymentTotalInSaleCurrency(uzsAmount, usdAmount, saleCurrency, cbuRate),
          saleCurrency,
        );
  return [
    rateLabel ? cp('confirmCbuRate', { label: rateLabel }) : null,
    cp('confirmSplitDue', { due: formatAmountForCurrency(due, saleCurrency) }),
    cp('confirmSplitPaying'),
    uzsLine,
    usdLine,
    cp('confirmSplitTotal', { currency: saleCurrency, total: totalPaid }),
    cp('confirmContinue'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Multiline confirm when payment exceeds amount due (shared by modal and inline flows). */
export function buildOverpayConfirmMessage(meta, exchangeRate) {
  const dueLabel = formatDisplayAmount(meta.due, meta.sc);
  const paidLabel = formatDisplayAmount(meta.paid, meta.sc);
  const excessLabel = formatDisplayAmount(meta.overpaymentAmount, meta.sc);
  return [
    cp('confirmOverpayTitle'),
    `${cp('confirmOverpayDue')} ${dueLabel} · ${cp('confirmOverpayEntered')} ${paidLabel} · ${cp('confirmOverpayExcess')} ${excessLabel}.`,
    meta.splitCurrency && exchangeRate?.label
      ? cp('confirmOverpayCbu', { label: exchangeRate.label })
      : null,
    cp('confirmOverpayBook'),
    cp('confirmContinue'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Multiline confirm when payment exceeds amount due and nothing was selected — additional profit. */
export function buildAdditionalProfitConfirmMessage(meta, exchangeRate) {
  const dueLabel = formatDisplayAmount(meta.due, meta.sc);
  const paidLabel = formatDisplayAmount(meta.paid, meta.sc);
  const excessLabel = formatDisplayAmount(meta.overpaymentAmount, meta.sc);
  return [
    cp('confirmOverpayTitle'),
    `${cp('confirmOverpayDue')} ${dueLabel} · ${cp('confirmOverpayEntered')} ${paidLabel} · ${cp('confirmOverpayExcess')} ${excessLabel}.`,
    meta.splitCurrency && exchangeRate?.label
      ? cp('confirmOverpayCbu', { label: exchangeRate.label })
      : null,
    cp('confirmAdditionalProfitBook'),
    cp('confirmContinue'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const emptyPaymentFormState = () => ({
  saleId: null,
  uzs: '',
  usd: '',
  prepayment_amount: '',
  total_sale_amount: '',
  dispatch_payment_needed: false,
  dispatch_payment_amount: '',
  dispatch_payment_currency: 'UZS',
  balance_shortfall_type: '',
  balance_shortfall_amount: '',
  apply_currency_conversion_difference: false,
  apply_additional_profit: false,
  apply_change: false,
  change_uzs: '',
  change_usd: '',
  completion_notes: '',
});

/**
 * Build initial payment form from a sale (same rules as Sales handleStatusUpdate → completed).
 */
/** Step 2 prefill: same UZS/USD split recorded at delivery step 1 (not CBU-converted total). */
export function deliveryStep2PaymentFromStep1(sale) {
  if (!sale?.delivery_customer_paid_at || sale.delivery_shop_remittance_at) {
    return null;
  }
  const uzs = parseFloat(sale.delivery_customer_collected_uzs) || 0;
  const usd = parseFloat(sale.delivery_customer_collected_usd) || 0;
  if (uzs <= 0 && usd <= 0) {
    return null;
  }
  return {
    uzs: uzs > 0 ? String(Math.round(uzs) === uzs ? Math.round(uzs) : uzs) : '',
    usd: usd > 0 ? (Number.isInteger(usd) ? String(usd) : usd.toFixed(2)) : '',
  };
}

export function buildPaymentFormDataFromSale(sale, cbuRate) {
  if (!sale) return emptyPaymentFormState();

  const unitPrice = saleEffectiveUnitPrice(sale);
  const quantity = parseFloat(sale.quantity || 0);
  const totalAmount = !isNaN(unitPrice * quantity) ? unitPrice * quantity : 0;
  const advancePaymentRaw = parseFloat(sale.advance_payment_received || 0);
  const advanceInSc = advanceAmountInSaleCurrency(sale, cbuRate);
  const nowBeingPaid =
    advanceInSc == null ? null : Math.max(0, totalAmount - advanceInSc);

  const dispatch = sale.dispatch_info;
  const uzsV = dispatch ? parseFloat(dispatch.delivery_cost_uzs || 0) : 0;
  const usdV = dispatch ? parseFloat(dispatch.delivery_cost || 0) : 0;
  const hasDispatchCost = !!(dispatch && (uzsV > 0 || usdV > 0));
  const dispatchPaymentNeeded = !!(dispatch && !dispatch.is_paid && hasDispatchCost);
  const dispatchAmountForForm = hasDispatchCost
    ? uzsV > 0
      ? (dispatch.delivery_cost_uzs != null && dispatch.delivery_cost_uzs !== ''
          ? String(dispatch.delivery_cost_uzs)
          : '')
      : dispatch.delivery_cost != null && dispatch.delivery_cost !== ''
        ? String(dispatch.delivery_cost)
        : ''
    : '';

  const isFromOrder = !!(sale.order || advancePaymentRaw > 0 || sale.sale_type === 'from_order');
  const sc = (sale.sale_currency || 'USD').toUpperCase();
  const listUnit = parseFloat(sale.selling_price) || 0;
  const discountAmountPerUnit = saleDiscountAmountPerUnit(sale);
  const finalUnit = saleEffectiveUnitPrice(sale);
  const listTotal = listUnit * quantity;
  const discountTotal = discountAmountPerUnit * quantity;

  let uzs = '';
  let usd = '';
  if (isFromOrder) {
    if (nowBeingPaid != null && nowBeingPaid > 0) {
      if (sc === 'UZS') uzs = String(Math.round(nowBeingPaid));
      else usd = nowBeingPaid.toFixed(2);
    } else if (nowBeingPaid === 0) {
      if (sc === 'UZS') uzs = '0';
      else usd = '0';
    }
    // nowBeingPaid == null → wait for CBU; leave payment fields empty
  } else if (sc === 'UZS') {
    uzs = String(Math.round(totalAmount));
  } else {
    usd = totalAmount.toFixed(2);
  }

  return {
    saleId: sale.id,
    completion_notes: '',
    uzs,
    usd,
    prepayment_amount:
      isFromOrder && advancePaymentRaw > 0 ? String(advancePaymentRaw) : '',
    prepayment_currency: isFromOrder && advancePaymentRaw > 0 ? getAdvanceCurrency(sale) : '',
    total_sale_amount: isFromOrder && advancePaymentRaw > 0 ? totalAmount.toFixed(2) : '',
    list_unit_price: listUnit,
    discount_amount_per_unit: discountAmountPerUnit,
    final_unit_price: finalUnit,
    list_total_amount: listTotal,
    sale_discount_total: discountTotal,
    final_amount_due:
      nowBeingPaid != null ? (nowBeingPaid > 0 ? nowBeingPaid : totalAmount) : totalAmount,
    sale_currency: sc,
    dispatch_payment_needed: !!dispatchPaymentNeeded,
    dispatch_payment_amount: dispatchPaymentNeeded ? dispatchAmountForForm : '',
    dispatch_payment_currency: dispatchPaymentNeeded
      ? parseFloat(dispatch.delivery_cost_uzs || 0) > 0
        ? 'UZS'
        : 'USD'
      : 'UZS',
    balance_shortfall_type: '',
    balance_shortfall_amount: '',
    apply_currency_conversion_difference: false,
    apply_additional_profit: false,
    apply_change: false,
    change_uzs: '',
    change_usd: '',
  };
}

/**
 * Payment difference after optional manual discount.
 * remaining = paid - (due - discount); negative = underpayment still unexplained without FX.
 */
export function computePaymentDifferenceMeta(sale, paymentFormData, cbuRate) {
  const base = computePaymentShortfallMeta(sale, paymentFormData, cbuRate);
  if (base.mixed || base.due == null || base.paid == null) {
    return {
      ...base,
      discountAmount: 0,
      remainingAfterDiscount: null,
      conversionDifference: null,
      differenceNeedsClassification: false,
      requiredChange: null,
    };
  }
  const wantDiscount = paymentFormData.balance_shortfall_type === 'discount';
  let discountAmount = 0;
  if (wantDiscount) {
    const entered = parseFloat(paymentFormData.balance_shortfall_amount);
    discountAmount = Number.isFinite(entered) && entered > 0 ? entered : 0;
  }
  const remainingAfterDiscount = base.paid - (base.due - discountAmount);
  const tol = (base.sc || 'USD').toUpperCase() === 'UZS' ? 1 : PAYMENT_SHORTFALL_TOLERANCE;
  const wantFx = !!paymentFormData.apply_currency_conversion_difference;
  const wantAdditionalProfit = !!paymentFormData.apply_additional_profit;
  const isOverpay = remainingAfterDiscount > tol;
  // FX wins if both are somehow set; additional profit only ever explains a genuine surplus.
  const apExplained = !wantFx && wantAdditionalProfit && isOverpay;
  const unexplained = (wantFx || apExplained) ? 0 : remainingAfterDiscount;
  const differenceNeedsClassification = Math.abs(unexplained) > tol;
  // Reachable only for overpayment with nothing selected yet (advance sales stay hard-blocked).
  const needsAdditionalProfitConfirm =
    !wantFx && !wantAdditionalProfit && isOverpay && !base.hasAdvance;

  return {
    ...base,
    discountAmount,
    remainingAfterDiscount,
    // What the customer is owed back, before any change is entered — the number the form
    // offers to fill the change boxes with. Reads off the *gross* payment on purpose, so it
    // does not shrink to zero the moment change is typed in.
    requiredChange:
      base.paidGross != null ? base.paidGross - (base.due - discountAmount) : null,
    conversionDifference: wantFx ? remainingAfterDiscount : null,
    additionalProfitAmount: apExplained ? remainingAfterDiscount : null,
    differenceNeedsClassification,
    needsAdditionalProfitConfirm,
    // Surplus classified as FX or additional profit is not a generic overpayment confirm.
    hasOverpayment: (wantFx || apExplained) ? false : base.hasOverpayment,
    overpaymentAmount: (wantFx || apExplained) ? null : base.overpaymentAmount,
    exceedsRemainingDue: wantFx ? false : base.exceedsRemainingDue,
  };
}

/**
 * Shortfall: underpayment may be completed as discount only after the user selects it (no on credit).
 */
export function computePaymentShortfallMeta(sale, paymentFormData, cbuRate) {
  if (!sale) {
    return {
      needs: false,
      mixed: false,
      splitCurrency: false,
      crossCurrency: false,
      short: 0,
      due: null,
      paid: null,
      sc: 'USD',
      hasOverpayment: false,
      overpaymentAmount: null,
    };
  }
  const due = computeAdvanceRemainingDue(sale, null, cbuRate);
  const uzsT = parseFloat(paymentFormData.uzs) || 0;
  const usdT = parseFloat(paymentFormData.usd) || 0;
  const sc = (sale.sale_currency || 'USD').toUpperCase();
  const hasAdvance = saleHasOrderAdvance(sale);
  const splitCurrency = uzsT > 0 && usdT > 0;
  const needsCbu = paymentNeedsCbuConversion(uzsT, usdT, sc);
  const crossCurrency = needsCbu && !splitCurrency;
  const advNeedsCbu = hasAdvance && getAdvanceCurrency(sale) !== sc;

  if ((needsCbu && !cbuRate && (uzsT > 0 || usdT > 0)) || (advNeedsCbu && due == null)) {
    return {
      needs: false,
      mixed: true,
      splitCurrency,
      crossCurrency,
      short: due,
      sc,
      due,
      paid: null,
      hasOverpayment: false,
      overpaymentAmount: null,
      hasAdvance,
      exceedsRemainingDue: false,
    };
  }

  const paidGross = paymentAmountInSaleCurrency(paymentFormData.uzs, paymentFormData.usd, sc, cbuRate);
  // Change comes off before anything else looks at the payment, so shortfall, overpayment and
  // the classification options all reason about money the shop actually kept.
  const wantChange = !!paymentFormData.apply_change;
  const changeInSc = wantChange
    ? changeAmountInSaleCurrency(paymentFormData.change_uzs, paymentFormData.change_usd, sc, cbuRate)
    : 0;
  const changePending = wantChange && changeInSc == null;
  const paid = paidGross == null || changePending ? paidGross : paidGross - changeInSc;
  const short = paid != null ? due - paid : due;
  const payingOtherCurrency =
    hasAdvance &&
    ((sc === 'USD' && uzsT > 0 && usdT === 0) || (sc === 'UZS' && usdT > 0 && uzsT === 0));
  const exceedsRemainingDue =
    hasAdvance && paid != null && paid > due + PAYMENT_SHORTFALL_TOLERANCE;
  const overpaymentAmount =
    !hasAdvance && paid != null && paid > due + PAYMENT_SHORTFALL_TOLERANCE ? paid - due : null;
  const hasOverpayment =
    !hasAdvance && !!overpaymentAmount && overpaymentAmount > PAYMENT_SHORTFALL_TOLERANCE;
  const needs =
    paid != null && !payingOtherCurrency && (
      paymentHasShortfall(due, paid, sc)
      || (!!overpaymentAmount && overpaymentAmount > PAYMENT_SHORTFALL_TOLERANCE)
    );

  return {
    needs,
    mixed: false,
    splitCurrency,
    crossCurrency,
    short,
    sc,
    due,
    paid,
    hasOverpayment,
    overpaymentAmount,
    hasAdvance,
    exceedsRemainingDue,
    paidGross,
    changeInSc,
    changePending,
    wantChange,
  };
}

/**
 * Reserved sale: total_amount − deposit; supports combined UZS+USD at CBU rate.
 *
 * `form` (optional) is the sell-reserved form state, read for its change and discount fields.
 * As on the Complete & Pay side, change is netted off before anything reads the payment, so
 * the discount prompt and the surplus confirm only ever see what the shop kept.
 */
export function computeReservedPaymentMeta(sale, uzsStr, usdStr, cbuRate, form = null) {
  if (!sale) {
    return {
      needsDiscountChoice: false,
      needsRate: false,
      splitCurrency: false,
      crossCurrency: false,
    };
  }
  const deposit = sale.deposit_received ? parseFloat(sale.deposit_amount || 0) : 0;
  const due = parseFloat(sale.total_amount || 0) - deposit;
  const sc = (sale.sale_currency || 'USD').toUpperCase();
  const uzsT = parseFloat(uzsStr) || 0;
  const usdT = parseFloat(usdStr) || 0;
  const splitCurrency = uzsT > 0 && usdT > 0;
  const crossCurrency =
    !splitCurrency &&
    ((sc === 'USD' && uzsT > 0 && usdT === 0) || (sc === 'UZS' && usdT > 0 && uzsT === 0));

  if (uzsT === 0 && usdT === 0) {
    return { needsDiscountChoice: false, needsRate: false, splitCurrency, crossCurrency, due, sc };
  }

  if ((splitCurrency || crossCurrency) && !cbuRate) {
    return {
      needsDiscountChoice: false,
      needsRate: true,
      splitCurrency,
      crossCurrency,
      due,
      sc,
      uzsT,
      usdT,
    };
  }

  const paidGross = paymentAmountInSaleCurrency(uzsStr, usdStr, sc, cbuRate);
  const wantChange = !!form?.apply_change;
  const changeInSc = wantChange
    ? changeAmountInSaleCurrency(form.change_uzs, form.change_usd, sc, cbuRate)
    : 0;
  const changePending = wantChange && changeInSc == null;
  const paid = paidGross == null || changePending ? paidGross : paidGross - changeInSc;
  const short = paid != null ? due - paid : due;
  const needsDiscountChoice = paymentHasShortfall(due, paid, sc);
  const discountAmount =
    form?.balance_shortfall_type === 'discount'
      ? Math.max(0, parseFloat(form.balance_shortfall_amount) || 0)
      : 0;
  return {
    needsDiscountChoice,
    needsRate: false,
    splitCurrency,
    crossCurrency,
    due,
    paid,
    paidGross,
    changeInSc,
    changePending,
    requiredChange: paidGross != null ? paidGross - (due - discountAmount) : null,
    short,
    sc,
    uzsT,
    usdT,
  };
}

export function buildCompleteSaleRequest(paymentFormData, meta, exchangeRate) {
  const requestData = {
    status: 'completed',
    notes: String(paymentFormData.completion_notes || '').trim(),
    uzs: parseFloat(paymentFormData.uzs) || 0,
    usd: parseFloat(paymentFormData.usd) || 0,
  };
  if (paymentFormData.balance_shortfall_type === 'discount') {
    requestData.balance_shortfall_type = 'discount';
    const disc = parseFloat(paymentFormData.balance_shortfall_amount);
    if (Number.isFinite(disc) && disc > 0) {
      requestData.balance_shortfall_amount = disc;
    }
  }
  if (paymentFormData.apply_currency_conversion_difference) {
    requestData.apply_currency_conversion_difference = true;
  }
  if (paymentFormData.apply_additional_profit && !paymentFormData.apply_currency_conversion_difference) {
    requestData.apply_additional_profit = true;
  }
  const changeUzs = paymentFormData.apply_change ? parseFloat(paymentFormData.change_uzs) || 0 : 0;
  const changeUsd = paymentFormData.apply_change ? parseFloat(paymentFormData.change_usd) || 0 : 0;
  if (changeUzs > 0) requestData.change_uzs = changeUzs;
  if (changeUsd > 0) requestData.change_usd = changeUsd;
  const uzsT = requestData.uzs;
  const usdT = requestData.usd;
  const needsCbu =
    exchangeRate?.rate &&
    ((uzsT > 0 && usdT > 0) ||
      meta?.splitCurrency ||
      (meta?.crossCurrency && (uzsT > 0 || usdT > 0)) ||
      // Change crossing the currency line has to be valued at the same rate the server uses.
      changeUzs > 0 ||
      changeUsd > 0);
  if (needsCbu) {
    requestData.exchange_rate = exchangeRate.rate;
  }
  if (paymentFormData.dispatch_payment_needed) {
    const dAmt = parseFloat(String(paymentFormData.dispatch_payment_amount).replace(',', '.')) || 0;
    requestData.dispatch_payment_amount = dAmt;
    requestData.dispatch_payment_currency = paymentFormData.dispatch_payment_currency || 'UZS';
  }
  return requestData;
}

/** Split one group payment across line items (remainder on last sale to avoid rounding drift). */
export function buildGroupCompleteRequests(groupSales, paymentFormData, meta, exchangeRate) {
  if (!groupSales?.length) return [];
  const cbuRate = exchangeRate?.rate ?? null;
  const dues = groupSales.map((sale) => computeAdvanceRemainingDue(sale, null, cbuRate) || 0);
  const totalDue = dues.reduce((sum, d) => sum + d, 0);
  const uzsIn = parseFloat(paymentFormData.uzs) || 0;
  const usdIn = parseFloat(paymentFormData.usd) || 0;
  let uzsLeft = uzsIn;
  let usdLeft = usdIn;

  // Change is split by the *same* weights as the payment, not dropped whole onto the last
  // line. The payment shares carry the group's surplus in proportion to each line's due, so
  // the matching share of the change is what cancels it; putting it all on one line would
  // leave that line paying far under its own due and the rest far over.
  const wantChange = !!paymentFormData.apply_change;
  const changeUzsIn = wantChange ? parseFloat(paymentFormData.change_uzs) || 0 : 0;
  const changeUsdIn = wantChange ? parseFloat(paymentFormData.change_usd) || 0 : 0;
  let changeUzsLeft = changeUzsIn;
  let changeUsdLeft = changeUsdIn;

  const applyGroupDiscount = paymentFormData.balance_shortfall_type === 'discount';

  return groupSales.map((sale, idx) => {
    const isLast = idx === groupSales.length - 1;
    const weight = totalDue > 0 ? dues[idx] / totalDue : 1 / groupSales.length;
    const uzsShare = isLast ? uzsLeft : Math.round(uzsIn * weight);
    const usdShare = isLast ? usdLeft : Math.round(usdIn * weight * 100) / 100;
    uzsLeft -= uzsShare;
    usdLeft -= usdShare;

    const changeUzsShare = isLast ? changeUzsLeft : Math.round(changeUzsIn * weight);
    const changeUsdShare = isLast ? changeUsdLeft : Math.round(changeUsdIn * weight * 100) / 100;
    changeUzsLeft -= changeUzsShare;
    changeUsdLeft -= changeUsdShare;

    const childForm = {
      ...paymentFormData,
      uzs: uzsShare > 0 ? String(uzsShare) : '',
      usd: usdShare > 0 ? String(usdShare) : '',
      balance_shortfall_type: applyGroupDiscount ? 'discount' : '',
      apply_change: wantChange && (changeUzsShare > 0 || changeUsdShare > 0),
      change_uzs: changeUzsShare > 0 ? String(changeUzsShare) : '',
      change_usd: changeUsdShare > 0 ? String(changeUsdShare) : '',
    };
    const childMeta = isLast ? meta : { ...meta, needs: false, hasOverpayment: false, overpaymentAmount: null };
    return {
      id: sale.id,
      data: buildCompleteSaleRequest(childForm, childMeta, exchangeRate),
    };
  });
}

/** Delivery after dispatch: 3-step settlement instead of single Complete & Pay (shop or from-order). */
export function shopDeliverySettlementRequired(sale) {
  if (!sale || sale.status !== 'dispatched') return false;
  if (sale.sale_type !== 'delivery') return false;
  return !!sale.dispatch_info;
}

/** 1–3 which settlement step applies; 0 if every timestamp exists (usually sale is completed). Null if not eligible. */
export function shopDeliverySettlementActiveStep(sale) {
  if (!shopDeliverySettlementRequired(sale)) return null;
  if (!sale.delivery_customer_paid_at) return 1;
  if (!sale.delivery_shop_remittance_at) return 2;
  if (!sale.delivery_dispatcher_fee_completed_at) return 3;
  return 0;
}

/** Primary label for the third settlement action (dispatch fee vs no fee). */
export function shopDeliverySettlementStep3Label(sale) {
  const d = sale?.dispatch_info || null;
  const uzFee = d ? parseFloat(d.delivery_cost_uzs ?? 0) || 0 : 0;
  const usFee = d ? parseFloat(d.delivery_cost ?? 0) || 0 : 0;
  const needsDispatchFeePayment = !!(d && !d.is_paid && (uzFee > 0 || usFee > 0));
  return needsDispatchFeePayment
    ? i18n.t('deliverySettlement.btnStep3Pay', { ns: 'sales' })
    : i18n.t('deliverySettlement.btnStep3Complete', { ns: 'sales' });
}

/** True while a customer-declined item hasn't yet been confirmed physically back at the shop. */
export function lineIsDeclinedPending(sale) {
  return !!(sale?.delivery_customer_declined_at && !sale?.delivery_return_confirmed_at);
}

/** True when this line is still an active part of the delivery settlement flow (not declined). */
export function lineNeedsSettlement(sale) {
  return shopDeliverySettlementRequired(sale) && !sale?.delivery_customer_declined_at;
}

function _groupLines(saleOrGroup) {
  const lines = saleOrGroup?.groupSales?.length ? saleOrGroup.groupSales : [saleOrGroup];
  return lines.filter(Boolean);
}

/** Lowest active step (1/2/3) across a group's still-active lines; 0 if none need settlement. */
export function groupSettlementActiveStep(lines) {
  const steps = (lines || [])
    .filter((l) => lineNeedsSettlement(l))
    .map((l) => shopDeliverySettlementActiveStep(l))
    .filter((s) => s != null && s !== 0);
  if (!steps.length) return 0;
  return Math.min(...steps);
}

/** True if any line in the group was declined at step 1 but not yet confirmed physically returned. */
export function groupHasPendingDeclinedReturns(lines) {
  return (lines || []).some((l) => lineIsDeclinedPending(l));
}

/** Group-aware replacement for shopDeliverySettlementRequired — true if any line still needs
 * settlement, or any line has a pending declined-return confirmation still outstanding. */
export function shopDeliverySettlementRequiredForGroup(saleOrGroup) {
  const lines = _groupLines(saleOrGroup);
  return lines.some((l) => lineNeedsSettlement(l)) || groupHasPendingDeclinedReturns(lines);
}
