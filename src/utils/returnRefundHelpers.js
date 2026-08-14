/** Refund payment validation (CBU split currency) for Returns — no discount / shortfall option. */

import {
  PAYMENT_SHORTFALL_TOLERANCE,
  paymentAmountInSaleCurrency,
  paymentNeedsCbuConversion,
  paymentHasShortfall,
  uzsToUsd,
  usdToUzs,
} from './saleCompletePayHelpers';
import { formatDisplayAmount } from './currencyFormat';
import i18n from '../i18n';

const tr = (key, opts) => i18n.t(key, { ns: 'returns', ...opts });

/**
 * Refund owed on a return, as the pair of amounts it is actually owed in.
 *
 * A return reverses a sale that was often settled in both currencies at once, so the obligation
 * is a pair. Three sources, in order: the legs stored when the return was recorded; the legacy
 * single amount, for rows written before the split; and finally what the customer paid on the
 * sale itself.
 */
export function computeReturnRefundDueLegs(returnItem) {
  const legUzs = parseFloat(returnItem?.sold_price_uzs);
  const legUsd = parseFloat(returnItem?.sold_price_usd);
  const uzs = Number.isFinite(legUzs) && legUzs > 0 ? legUzs : 0;
  const usd = Number.isFinite(legUsd) && legUsd > 0 ? legUsd : 0;
  if (uzs > 0 || usd > 0) return { uzs, usd };

  const storedTotal = parseFloat(returnItem?.sold_price);
  const storedCurrency = String(returnItem?.sold_price_currency || '').toUpperCase();
  if (
    returnItem?.sold_price != null &&
    returnItem.sold_price !== '' &&
    Number.isFinite(storedTotal) &&
    storedTotal > 0 &&
    (storedCurrency === 'USD' || storedCurrency === 'UZS')
  ) {
    return storedCurrency === 'UZS' ? { uzs: storedTotal, usd: 0 } : { uzs: 0, usd: storedTotal };
  }

  const sale = returnItem?.sale_detail;
  const qty = parseInt(returnItem?.quantity, 10) || 0;
  const legs = sale?.paid_legs;
  if (legs && qty > 0) {
    const soldQty = parseInt(sale?.quantity, 10) || 0;
    const factor = soldQty > 0 && qty < soldQty ? qty / soldQty : 1;
    const paidUzs = (Number(legs.uzs) || 0) * factor;
    const paidUsd = (Number(legs.usd) || 0) * factor;
    if (paidUzs > 0 || paidUsd > 0) {
      return {
        uzs: paidUzs > 0 ? Math.round(paidUzs) : 0,
        usd: paidUsd > 0 ? parseFloat(paidUsd.toFixed(2)) : 0,
      };
    }
  }
  return { uzs: 0, usd: 0 };
}

/**
 * LEGACY single-currency view of the same obligation, for the confirmation dialogs that still
 * phrase the refund as one figure. Cross-currency dues report in dollars.
 */
export function computeReturnRefundDue(returnItem) {
  const qty = parseInt(returnItem?.quantity, 10) || 0;
  const { uzs, usd } = computeReturnRefundDueLegs(returnItem);
  if (uzs <= 0 && usd <= 0) {
    const sale = returnItem?.sale_detail;
    const currency = (sale?.sale_currency || 'USD').toUpperCase();
    return { amount: null, currency, unitPrice: NaN };
  }
  if (uzs > 0 && usd <= 0) {
    return { amount: uzs, currency: 'UZS', unitPrice: qty > 0 ? uzs / qty : NaN };
  }
  if (usd > 0 && uzs <= 0) {
    return { amount: usd, currency: 'USD', unitPrice: qty > 0 ? usd / qty : NaN };
  }
  // Both legs live: there is no honest single-currency figure without a rate, so the caller is
  // handed the pair as well and must use it. `amount` is deliberately null rather than one leg,
  // which would understate the debt to anything that read it on its own.
  return { amount: null, currency: 'USD', unitPrice: NaN, uzs, usd };
}

function formatAmountForCurrency(amount, currency) {
  return formatDisplayAmount(amount, currency);
}

/** Combined refund in sold-price currency; requires CBU rate when legs use more than one currency bucket. */
export function computeRefundPaidInDueCurrency(uzsT, usdT, dueCurrency, cbuRate) {
  const sc = (dueCurrency || 'USD').toUpperCase();
  const uzs = parseFloat(uzsT) || 0;
  const usd = parseFloat(usdT) || 0;
  if (uzs <= 0 && usd <= 0) {
    return { ok: true, paid: 0, needsRate: false, splitCurrency: false, crossCurrency: false };
  }
  const splitCurrency = uzs > 0 && usd > 0;
  const crossCurrency = paymentNeedsCbuConversion(uzs, usd, sc) && !splitCurrency;
  const paid = paymentAmountInSaleCurrency(uzsT, usdT, sc, cbuRate);
  if (paymentNeedsCbuConversion(uzs, usd, sc) && paid === null) {
    return { ok: false, paid: null, needsRate: true, splitCurrency, crossCurrency };
  }
  return { ok: true, paid, needsRate: false, splitCurrency, crossCurrency };
}

/**
 * Refund validation meta. Underpayment vs sold_price due is allowed when the user confirms partial refund.
 */
export function computeReturnRefundMeta(returnItem, refundFormData, cbuRate) {
  const dueLegs = computeReturnRefundDueLegs(returnItem);
  const dueInfo = computeReturnRefundDue(returnItem);
  // A debt owed in both currencies has no single-currency size until a rate is known. Expressed
  // in dollars for the comparison below — the comparison only; the legs are what is settled.
  const crossCurrencyDue = dueLegs.uzs > 0 && dueLegs.usd > 0;
  const sc = crossCurrencyDue ? 'USD' : dueInfo.currency || 'USD';
  const due = crossCurrencyDue
    ? cbuRate && cbuRate > 0
      ? dueLegs.usd + dueLegs.uzs / cbuRate
      : null
    : dueInfo.amount;
  const uzsT = parseFloat(refundFormData?.uzs) || 0;
  const usdT = parseFloat(refundFormData?.usd) || 0;

  const empty = {
    mixed: false,
    splitCurrency: false,
    needs: false,
    short: 0,
    due,
    paid: null,
    sc,
    hasOverpayment: false,
    overpaymentAmount: null,
    exceedsDue: false,
    dueUnavailable: due == null || Number.isNaN(due),
  };

  if (empty.dueUnavailable) {
    return empty;
  }

  const paidResult = computeRefundPaidInDueCurrency(uzsT, usdT, sc, cbuRate);
  if (!paidResult.ok) {
    return {
      ...empty,
      mixed: paidResult.needsRate,
      splitCurrency: paidResult.splitCurrency,
    };
  }

  const paid = paidResult.paid;
  const short = due - paid;
  const overpayTol = sc === 'UZS' ? 1 : PAYMENT_SHORTFALL_TOLERANCE;
  const exceedsDue = paid > due + overpayTol;
  const overpaymentAmount = exceedsDue ? paid - due : null;
  const hasOverpayment = !!overpaymentAmount && overpaymentAmount > overpayTol;

  return {
    mixed: false,
    splitCurrency: paidResult.splitCurrency,
    crossCurrency: paidResult.crossCurrency,
    needs: paymentHasShortfall(due, paid, sc),
    short,
    due,
    paid,
    sc,
    hasOverpayment,
    overpaymentAmount,
    exceedsDue,
    dueUnavailable: false,
  };
}

export function buildReturnRefundRequest(refundFormData, exchangeRate, options = {}) {
  const requestData = {
    uzs: parseFloat(refundFormData.uzs) || 0,
    usd: parseFloat(refundFormData.usd) || 0,
  };
  if (exchangeRate?.rate && requestData.uzs > 0 && requestData.usd > 0) {
    requestData.exchange_rate = exchangeRate.rate;
  } else if (exchangeRate?.rate) {
    const uzsT = requestData.uzs;
    const usdT = requestData.usd;
    if ((uzsT > 0 && usdT === 0) || (usdT > 0 && uzsT === 0)) {
      requestData.exchange_rate = exchangeRate.rate;
    }
  }
  if (options.acceptPartialRefund || options.acceptSplitUnderpayment) {
    requestData.accept_partial_refund = true;
    requestData.accept_split_underpayment = true;
  }
  // How a difference between what is owed and what is being paid is accounted for. Sent only
  // when the cashier ticked something, so a refund that settles exactly still posts a clean body.
  const diff = options.difference;
  if (diff?.pl) {
    requestData.apply_refund_pl = true;
    if (String(diff.plAmount ?? '').trim() !== '') {
      requestData.refund_pl_amount = diff.plAmount;
    }
  }
  if (diff?.fx) {
    requestData.apply_refund_currency_conversion_difference = true;
  }
  return requestData;
}

/** Signed gap between what is owed and what is being paid; positive = paying less than owed. */
export function refundSettlementGap(meta) {
  if (meta?.due == null || meta?.paid == null) return null;
  if (Number.isNaN(meta.due) || Number.isNaN(meta.paid)) return null;
  return meta.due - meta.paid;
}

export function refundGapIsSignificant(meta) {
  const gap = refundSettlementGap(meta);
  if (gap == null) return false;
  const tol = (meta.sc || 'USD').toUpperCase() === 'UZS' ? 1 : 0.005;
  return Math.abs(gap) > tol;
}

/**
 * Single confirmation for combined UZS+USD refund (replaces separate split / under / final dialogs).
 */
export function buildReturnCombinedRefundConfirmMessage({
  returnItem,
  meta,
  uzsAmount,
  usdAmount,
  exchangeRate,
  cbuRate,
}) {
  const sc = meta.sc || 'USD';
  const rateLine = exchangeRate?.label
    ? tr('confirm.cbuRateLabel', { label: exchangeRate.label })
    : cbuRate
      ? tr('confirm.cbuRateUsdUzs', {
          rate: Number(cbuRate).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        })
      : null;

  const uzsLine =
    uzsAmount > 0
      ? sc === 'USD'
        ? `- ${formatAmountForCurrency(uzsAmount, 'UZS')} (≈ ${formatAmountForCurrency(uzsToUsd(uzsAmount, cbuRate), sc)} at CBU)`
        : `- ${formatAmountForCurrency(uzsAmount, 'UZS')}`
      : null;
  const usdLine =
    usdAmount > 0
      ? sc === 'UZS'
        ? `- ${formatAmountForCurrency(usdAmount, 'USD')} (≈ ${formatAmountForCurrency(usdToUzs(usdAmount, cbuRate), sc)} at CBU)`
        : `- ${formatAmountForCurrency(usdAmount, 'USD')}`
      : null;

  const totalLine =
    meta.paid != null
      ? tr('confirm.totalRefundInCurrency', {
          currency: sc,
          amount: formatAmountForCurrency(meta.paid, sc),
        })
      : null;
  const dueLine =
    meta.due != null
      ? tr('confirm.refundDueInCurrency', {
          currency: sc,
          amount: formatAmountForCurrency(meta.due, sc),
        })
      : null;

  let statusLine = tr('confirm.matchesDue');
  if (meta.needs && meta.short > 0) {
    statusLine = tr('confirm.belowDueRemainder', {
      short: formatAmountForCurrency(meta.short, sc),
    });
  } else if (meta.hasOverpayment && meta.overpaymentAmount != null) {
    statusLine = tr('confirm.aboveDueExcess', {
      excess: formatAmountForCurrency(meta.overpaymentAmount, sc),
    });
  }

  const productLabel = returnItem?.product_detail
    ? `${returnItem.product_detail.brand} ${returnItem.product_detail.model}`
    : tr('confirm.productFallback', { id: returnItem?.product ?? '?' });
  const customerLine = returnItem?.customer_detail?.name
    ? tr('confirm.customerLine', { name: returnItem.customer_detail.name })
    : null;

  return [
    tr('confirm.markRefundedTitle', { id: returnItem?.id ?? '?' }),
    '',
    productLabel,
    customerLine,
    returnItem?.quantity != null ? tr('confirm.qtyLine', { qty: returnItem.quantity }) : null,
    '',
    rateLine,
    dueLine,
    tr('confirm.payingLabel'),
    uzsLine,
    usdLine,
    totalLine,
    statusLine,
    '',
    tr('confirm.proceedShort'),
  ]
    .filter((line) => line != null && line !== '')
    .join('\n');
}

export function buildReturnCrossCurrencyConfirmMessage({
  due,
  sc,
  otherCurrency,
  otherAmount,
  paidInSaleCurrency,
  exchangeRate,
  cbuRate,
}) {
  const dueLabel = formatAmountForCurrency(due, sc);
  const payLabel = formatAmountForCurrency(otherAmount, otherCurrency);
  const rateLine = exchangeRate?.label
    ? tr('confirm.cbuRateBased', { label: exchangeRate.label })
    : cbuRate
      ? tr('confirm.cbuRateBasedUsdUzs', {
          rate: Number(cbuRate).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        })
      : null;
  const equiv =
    cbuRate && otherAmount > 0
      ? sc === 'USD' && otherCurrency === 'UZS'
        ? `(equivalent to ${formatAmountForCurrency(uzsToUsd(otherAmount, cbuRate), sc)} at CBU rate)`
        : sc === 'UZS' && otherCurrency === 'USD'
          ? `(equivalent to ${formatAmountForCurrency(usdToUzs(otherAmount, cbuRate), sc)} at CBU rate)`
          : null
      : null;
  const totalLine =
    paidInSaleCurrency != null
      ? tr('confirm.totalRefundInCurrency', {
          currency: sc,
          amount: formatAmountForCurrency(paidInSaleCurrency, sc),
        })
      : null;
  return [
    rateLine,
    tr('confirm.crossCurrencyDue', { currency: sc, amount: dueLabel }),
    tr('confirm.crossCurrencyPaying', {
      payAmount: payLabel,
      payCurrency: otherCurrency,
      equiv: equiv || '',
    }),
    totalLine,
    tr('confirm.continue'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

