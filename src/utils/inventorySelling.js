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
 * The single place that decides *which* price a layer carries. It takes the whole inventory row,
 * because the answer can come from any of three places and only the row knows all three:
 *
 *   1. the layer's own price, if somebody has re-priced this shelf line
 *   2. the planned selling price on the order that brought the stock in
 *   3. the product's default
 *
 * The Inventory table and the printed sticker format the result differently — the table uses
 * `$`/`so'm`, the label uses `y.e`/`uzs` at the shop's request — but they must never disagree
 * about the figure itself. A sticker quoting a price the system does not is worse than a sticker
 * with no price at all. `resolveLayerListPrice` follows the same order for the sale form, so what
 * the shelf says is what the counter offers.
 *
 * *Known nuance, deliberately preserved:* step 2 is USD-only, so a layer from a soum-priced order
 * falls through to the product's price. That is the behaviour already on screen, and re-pricing
 * the layer is now the way to override it.
 */
export function layerSellingQuote(layer) {
  // 1. The layer's own price, if somebody has set one. It is the only source that belongs to the
  //    row you are looking at, so it is asked first — otherwise re-pricing a shelf line would
  //    save correctly and change nothing on screen.
  const own = parseFloat(layer?.selling_price);
  if (Number.isFinite(own) && own > 0) {
    return {
      amount: own,
      currency: (layer.selling_price_currency || 'USD').toUpperCase(),
      source: 'layer',
    };
  }
  // 2. What the purchase that brought this stock in planned to sell it for.
  const fromOrder = plannedSellingUsdPerUnit(layer?.stocking_order || null);
  if (fromOrder != null && fromOrder > 0) {
    return { amount: fromOrder, currency: 'USD', source: 'order' };
  }
  // 3. The product's default.
  const product = layer?.product_detail;
  const amount = parseFloat(product?.selling_price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    amount,
    currency: (product?.selling_price_currency || 'USD').toUpperCase(),
    source: 'product',
  };
}

/**
 * The price as the Inventory table prints it — `$120.00/u`, `120 000 so'm/u`, or a dash.
 *
 * Formatting only; the figure comes from `layerSellingQuote`.
 */
export function inventorySellingCell(layer) {
  const quote = layerSellingQuote(layer);
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
