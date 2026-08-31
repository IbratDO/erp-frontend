/**
 * Shared UZS/USD + CBU payment validation (shop Complete & Pay, delivery settlement, from-order).
 */

import i18n from '../i18n';
import {
  computeAdvanceRemainingDue,
  computePaymentDifferenceMeta,
  paymentHasShortfall,
  validateAdvanceCompletionPayment,
  buildCrossCurrencyAdvanceConfirmMessage,
  buildSplitCurrencyConfirmMessage,
  buildAdditionalProfitConfirmMessage,
  buildCreditConfirmMessage,
  buildCompleteSaleRequest,
  paymentAmountInSaleCurrency,
} from './saleCompletePayHelpers';
import { formatDisplayAmount } from './currencyFormat';

function cp(key, opts) {
  return i18n.t(`completePay.${key}`, { ns: 'sales', ...opts });
}

/**
 * Run the same confirm/validate flow as SaleCompletePayForm before posting payment.
 * @returns {Promise<{ ok: boolean, requestData?: object }>}
 */
export async function runSalePaymentSubmitFlow({
  sale,
  paymentFormData,
  exchangeRate,
  exchangeRateError,
  showNotification,
  sellingPriceOverride,
  allowDiscount = true,
}) {
  const cbuRate = exchangeRate?.rate ?? null;
  const meta = computePaymentDifferenceMeta(sale, paymentFormData, cbuRate);
  const uzsT = parseFloat(paymentFormData.uzs) || 0;
  const usdT = parseFloat(paymentFormData.usd) || 0;

  const wantsCredit = !!paymentFormData.apply_credit;

  // A sale whose order advance already covers the whole price has nothing left to collect. The
  // customer paid weeks ago; the money is in the books as a customer advance, and completing the
  // sale releases that liability against the revenue. There is no figure the operator could type
  // here that would be correct — zero *is* the answer.
  //
  // `computeAdvanceRemainingDue` returns null when a cross-currency advance has no rate yet.
  // That is "not known", not "nothing owed", and must not open the gate.
  const remainingDue = computeAdvanceRemainingDue(sale, sellingPriceOverride, cbuRate);
  const nothingLeftToPay =
    remainingDue != null && !paymentHasShortfall(remainingDue, 0, sale?.sale_currency);

  // "Enter at least one amount" is the right rule everywhere money is still expected. It has now
  // grown two exceptions — a sale taken wholly on credit, and one already paid in full up front —
  // and both are cases where handing over nothing is the whole answer rather than a missing one.
  if (uzsT + usdT === 0 && !wantsCredit && !nothingLeftToPay) {
    showNotification?.(cp('errEnterPayment'), 'error');
    return { ok: false };
  }

  if (paymentFormData.apply_change) {
    const chUzs = parseFloat(paymentFormData.change_uzs) || 0;
    const chUsd = parseFloat(paymentFormData.change_usd) || 0;
    if (chUzs <= 0 && chUsd <= 0) {
      showNotification?.(cp('errChangeAmount'), 'error');
      return { ok: false };
    }
    if (meta.changePending) {
      showNotification?.(exchangeRateError || cp('errRateLoading'), 'error');
      return { ok: false };
    }
  }

  const advanceCheck = validateAdvanceCompletionPayment(
    sale,
    paymentFormData.uzs,
    paymentFormData.usd,
    sellingPriceOverride,
    cbuRate,
    meta.changeInSc || 0,
    !!paymentFormData.apply_currency_conversion_difference
      || !!paymentFormData.apply_additional_profit,
  );
  if (!advanceCheck.ok) {
    showNotification?.(advanceCheck.error, 'error');
    return { ok: false };
  }

  if (meta.mixed) {
    showNotification?.(exchangeRateError || cp('errRateLoading'), 'error');
    return { ok: false };
  }

  if (advanceCheck.needsSplitCurrencyConfirm) {
    if (
      !window.confirm(
        buildSplitCurrencyConfirmMessage({
          sale,
          uzsAmount: advanceCheck.uzsAmount,
          usdAmount: advanceCheck.usdAmount,
          due: advanceCheck.due,
          sc: advanceCheck.sc,
          cbuRate: advanceCheck.cbuRate,
          paidInSaleCurrency: advanceCheck.paidInSaleCurrency,
          exchangeRate,
        }),
      )
    ) {
      return { ok: false };
    }
  } else if (advanceCheck.needsCrossCurrencyConfirm) {
    if (!window.confirm(buildCrossCurrencyAdvanceConfirmMessage(advanceCheck, exchangeRate))) {
      return { ok: false };
    }
  } else if ((meta.splitCurrency || meta.crossCurrency) && (uzsT > 0 || usdT > 0)) {
    if (
      !window.confirm(
        buildSplitCurrencyConfirmMessage({
          sale,
          uzsAmount: uzsT,
          usdAmount: usdT,
          due: meta.due,
          sc: meta.sc,
          cbuRate,
          paidInSaleCurrency: meta.paid,
          exchangeRate,
        }),
      )
    ) {
      return { ok: false };
    }
  }

  if (meta.exceedsRemainingDue) {
    showNotification?.(
      cp('errExceedsDueFormatted', { amount: formatDisplayAmount(meta.due, meta.sc) }),
      'error',
    );
    return { ok: false };
  }

  if (
    allowDiscount
    && paymentFormData.balance_shortfall_type === 'discount'
    && !(parseFloat(paymentFormData.balance_shortfall_amount) > 0)
  ) {
    showNotification?.(cp('errDiscountAmount'), 'error');
    return { ok: false };
  }

  if (wantsCredit && meta.creditExplained) {
    if (meta.sharesExceedGap) {
      showNotification?.(cp('errSharesExceedGap'), 'error');
      return { ok: false };
    }
    if (meta.creditDueDateMissing) {
      showNotification?.(cp('errCreditDueDate'), 'error');
      return { ok: false };
    }
    if (!window.confirm(buildCreditConfirmMessage(meta, paymentFormData.credit_due_date))) {
      return { ok: false };
    }
  }
  if (wantsCredit && meta.creditWithNothingOwing) {
    showNotification?.(cp('errCreditNothingOwing'), 'error');
    return { ok: false };
  }

  // Ticked credit, then raised the payment until nothing was owing: drop the stale flag rather
  // than asking the server to open a debt of nothing.
  const staleCredit = wantsCredit && !meta.creditExplained;
  let effForm = staleCredit
    ? { ...paymentFormData, apply_credit: false, credit_amount: '', credit_due_date: '' }
    : paymentFormData;
  let effMeta = staleCredit ? computePaymentDifferenceMeta(sale, effForm, cbuRate) : meta;
  if (meta.needsAdditionalProfitConfirm) {
    if (!window.confirm(buildAdditionalProfitConfirmMessage(meta, exchangeRate))) return { ok: false };
    effForm = { ...effForm, apply_additional_profit: true };
    effMeta = computePaymentDifferenceMeta(sale, effForm, cbuRate);
  }

  if (allowDiscount && effMeta.differenceNeedsClassification) {
    showNotification?.(cp('errShortfall'), 'error');
    return { ok: false };
  }

  const requestData = buildCompleteSaleRequest(effForm, effMeta, exchangeRate);
  return { ok: true, requestData, meta: effMeta };
}

/** Total in sale list currency from UZS/USD legs (for delivery settlement display/API). */
export function combinedPaymentInSaleCurrency(sale, uzsStr, usdStr, cbuRate) {
  return paymentAmountInSaleCurrency(uzsStr, usdStr, sale?.sale_currency, cbuRate);
}
