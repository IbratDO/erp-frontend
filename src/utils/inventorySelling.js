import { plannedSellingUsdPerUnit } from './orderPlannedPricing';

/** Price with its own currency symbol — a product may be quoted in either. */
export function formatSellingPrice(amount, currency) {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'UZS'
    ? `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} so'm`
    : `$${n.toFixed(2)}`;
}

/**
 * What one unit of an inventory layer sells for: the number and the currency, before any
 * formatting.
 *
 * The single place that decides *which* price a layer carries. The Inventory table and the
 * printed sticker format it differently — the table uses `$`/`so'm`, the label uses `y.e`/`uzs`
 * at the shop's request — but they must never disagree about the figure itself. A sticker
 * quoting a price the system does not is worse than a sticker with no price at all.
 *
 * Order first, then the product's own price, which is the order the table has always used.
 *
 * *Known nuance, deliberately preserved:* the order branch is USD-only, so a layer from a
 * soum-priced order falls through to the product's price. That is the behaviour already on
 * screen; changing it would move what the table shows, which is a separate decision from how
 * the label prints it.
 */
export function layerSellingQuote(productDetail, stockingOrder) {
  const fromOrder = plannedSellingUsdPerUnit(stockingOrder || null);
  if (fromOrder != null && fromOrder > 0) {
    return { amount: fromOrder, currency: 'USD' };
  }
  const amount = parseFloat(productDetail?.selling_price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    amount,
    currency: (productDetail?.selling_price_currency || 'USD').toUpperCase(),
  };
}

/**
 * The price as the Inventory table prints it — `$120.00/u`, `120 000 so'm/u`, or a dash.
 *
 * Formatting only; the figure comes from `layerSellingQuote`.
 */
export function inventorySellingCell(productDetail, stockingOrder) {
  const quote = layerSellingQuote(productDetail, stockingOrder);
  if (!quote) return '—';
  const price = formatSellingPrice(quote.amount, quote.currency);
  return price ? `${price}/u` : '—';
}

/** The same figure as a number, for sorting and totals. */
export function invSellingPriceNum(item) {
  const so = item.stocking_order;
  if (so?.selling_price != null && String(so.selling_price).trim() !== '') {
    const n = parseFloat(so.selling_price);
    return Number.isFinite(n) ? n : 0;
  }
  const pu = parseFloat(item.product_detail?.selling_price);
  return Number.isFinite(pu) ? pu : 0;
}
