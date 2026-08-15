/**
 * Shared UZS/USD + CBU payment validation (shop Complete & Pay, delivery settlement, from-order).
 */

import i18n from '../i18n';
import {
  computePaymentDifferenceMeta,
  validateAdvanceCompletionPayment,
  buildCrossCurrencyAdvanceConfirmMessage,
  buildSplitCurrencyConfirmMessage,
  buildAdditionalProfitConfirmMessage,
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

  if (uzsT + usdT === 0) {
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

  let effForm = paymentFormData;
  let effMeta = meta;
  if (meta.needsAdditionalProfitConfirm) {
    if (!window.confirm(buildAdditionalProfitConfirmMessage(meta, exchangeRate))) return { ok: false };
    effForm = { ...paymentFormData, apply_additional_profit: true };
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
