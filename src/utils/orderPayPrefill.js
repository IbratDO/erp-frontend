import { numOrZero, plannedSupplierPaymentTotals } from './orderPlannedPricing';

function amountOrEmpty(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? String(Number(v.toFixed(2))) : '';
}

/**
 * Prefill "Pay for the Order" from planned supplier buckets (+ legacy cost_total as USD cash).
 */
export function prefillPayOrderFromSupplier(order) {
  if (!order) {
    return { uzs_cash: '', uzs_card: '', usd_cash: '', usd_card: '' };
  }
  const uzsCash = numOrZero(order.supplier_cost_uzs_cash);
  const uzsCard = numOrZero(order.supplier_cost_uzs_card);
  const usdCash = numOrZero(order.supplier_cost_usd_cash);
  const usdCard = numOrZero(order.supplier_cost_usd_card);
  if (uzsCash + uzsCard + usdCash + usdCard > 0) {
    return {
      uzs_cash: uzsCash ? String(uzsCash) : '',
      uzs_card: uzsCard ? String(uzsCard) : '',
      usd_cash: usdCash ? String(usdCash) : '',
      usd_card: usdCard ? String(usdCard) : '',
    };
  }
  const ct = numOrZero(order.cost_total);
  if (ct > 0) {
    return {
      uzs_cash: '',
      uzs_card: '',
      usd_cash: String(ct.toFixed(2)),
      usd_card: '',
    };
  }
  const qty = parseInt(order.ordered_quantity, 10) || 0;
  const pu = numOrZero(order.cost_per_unit);
  const fromUnit = qty > 0 && pu > 0 ? qty * pu : 0;
  if (fromUnit > 0) {
    return {
      uzs_cash: '',
      uzs_card: '',
      usd_cash: String(fromUnit.toFixed(2)),
      usd_card: '',
    };
  }
  // Last resort: product catalog unit cost × qty (when order line cost was left blank).
  const p = order.product_detail;
  if (p && qty > 0) {
    const pUzs = numOrZero(p.cost_uzs_cash) + numOrZero(p.cost_uzs_card);
    const pUsd = numOrZero(p.cost_usd_cash) + numOrZero(p.cost_usd_card);
    if (pUzs > 0 && pUsd <= 0) {
      return {
        uzs_cash: String((pUzs * qty).toFixed(2)),
        uzs_card: '',
        usd_cash: '',
        usd_card: '',
      };
    }
    if (pUsd > 0) {
      return {
        uzs_cash: '',
        uzs_card: '',
        usd_cash: String((pUsd * qty).toFixed(2)),
        usd_card: '',
      };
    }
  }
  return {
    uzs_cash: '',
    uzs_card: '',
    usd_cash: '',
    usd_card: '',
  };
}

/**
 * Fraction of the ordered quantity that actually turned up (1 when nothing is missing).
 * Planned supplier amounts are always for the full order, so a short delivery has to scale
 * them down before they are offered as a payment default.
 */
function receivedRatio(order) {
  const ordered = parseInt(order?.ordered_quantity, 10) || 0;
  const received = order?.received_quantity;
  if (!ordered || received === null || received === undefined) return 1;
  const receivedNum = parseInt(received, 10);
  if (!Number.isInteger(receivedNum) || receivedNum >= ordered) return 1;
  return receivedNum / ordered;
}

/**
 * Two-field totals for Orders.js payment form (UZS / USD), from planned supplier buckets.
 * Uses the same planned totals as pay-confirm dialogs, then falls back to buckets/product.
 *
 * Short deliveries prefill only what arrived — paying for goods that are not in the shop is
 * the expensive mistake here, and raising the amount by hand is easy if the rest is still
 * on its way.
 */
export function prefillPayOrderSimpleTotals(order) {
  if (!order) {
    return { uzs: '', usd: '' };
  }
  const ratio = receivedRatio(order);
  const planned = plannedSupplierPaymentTotals(order);
  if (planned.uzs > 0 || planned.usd > 0) {
    return {
      uzs: amountOrEmpty(planned.uzs * ratio),
      usd: amountOrEmpty(planned.usd * ratio),
    };
  }
  const b = prefillPayOrderFromSupplier(order);
  const uzs = numOrZero(b.uzs_cash) + numOrZero(b.uzs_card);
  const usd = numOrZero(b.usd_cash) + numOrZero(b.usd_card);
  return {
    uzs: amountOrEmpty(uzs * ratio),
    usd: amountOrEmpty(usd * ratio),
  };
}

/**
 * Prefill payment buckets from planned selling (for status flows that align with sale totals).
 */
export function prefillPayOrderFromSelling(order) {
  if (!order) {
    return { uzs_cash: '', uzs_card: '', usd_cash: '', usd_card: '' };
  }
  const uzsCash = parseFloat(order.selling_uzs_cash) || 0;
  const uzsCard = parseFloat(order.selling_uzs_card) || 0;
  const usdCash = parseFloat(order.selling_usd_cash) || 0;
  const usdCard = parseFloat(order.selling_usd_card) || 0;
  if (uzsCash + uzsCard + usdCash + usdCard > 0) {
    return {
      uzs_cash: uzsCash ? String(uzsCash) : '',
      uzs_card: uzsCard ? String(uzsCard) : '',
      usd_cash: usdCash ? String(usdCash) : '',
      usd_card: usdCard ? String(usdCard) : '',
    };
  }
  const qty = parseInt(order.ordered_quantity, 10) || 0;
  const spu = parseFloat(order.selling_price) || 0;
  const legacyUsdTotal = qty * spu;
  return {
    uzs_cash: '',
    uzs_card: '',
    usd_cash: legacyUsdTotal > 0 ? String(legacyUsdTotal.toFixed(2)) : '',
    usd_card: '',
  };
}
