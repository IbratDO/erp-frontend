import { plannedSellingSummary } from './orderPlannedPricing';

/** Price with its own currency symbol — a product may be quoted in either. */
export function formatSellingPrice(amount, currency) {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'UZS'
    ? `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} so'm`
    : `$${n.toFixed(2)}`;
}

/**
 * What one unit of an inventory layer sells for, as the Inventory table prints it.
 *
 * Lifted out of `Inventory.js` so the printed label reads the price from the same place the table
 * does. If they each had their own copy they would eventually disagree, and a sticker quoting a
 * price the system does not is worse than a sticker with no price at all.
 *
 * *Known nuance, deliberately left alone here:* `plannedSellingSummary` is USD-only, so a layer
 * from a soum-priced order falls through to the product's own price. That is the behaviour already
 * on screen; changing it would move what the table shows, which is a separate decision from
 * printing it.
 */
export function inventorySellingCell(productDetail, stockingOrder) {
  const label = plannedSellingSummary(stockingOrder || null);
  if (label) return label;
  const price = formatSellingPrice(
    productDetail?.selling_price,
    productDetail?.selling_price_currency,
  );
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
