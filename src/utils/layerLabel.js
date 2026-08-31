import { layerSellingQuote } from './inventorySelling';

/**
 * Money as the printed sticker writes it, which is not how the screen writes it.
 *
 * The shop asked for `120.00 y.e` and `120 000 uzs` rather than the `$` and `so'm` the tables
 * use. A label is read by a customer standing in front of the shelf, not by a member of staff
 * who already knows which currency the shop quotes in.
 *
 * The soum grouping is done by hand rather than through `toLocaleString`, which groups according
 * to whatever locale the browser happens to be in — commas on one machine, spaces on another,
 * and the label is a physical object that must not change depending on which computer printed
 * it. Spaces, always.
 */
export function formatLabelPrice(quote) {
  if (!quote || !Number.isFinite(quote.amount) || quote.amount <= 0) return '';
  if ((quote.currency || 'USD').toUpperCase() === 'UZS') {
    const grouped = String(Math.round(quote.amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${grouped} uzs`;
  }
  return `${quote.amount.toFixed(2)} y.e`;
}

/**
 * Turn an inventory row into the seven things printed on its sticker.
 *
 * `code` is the layer's stored `barcode`, taken from the API verbatim and never rebuilt here.
 * Regenerating it on this side would let the sticker and the database drift apart, which is the
 * one failure this whole design exists to avoid: a printed label that scans to nothing, or worse,
 * to something else.
 */
export function layerToLabelData(layer) {
  if (!layer || !layer.barcode) return null;
  const product = layer.product_detail || {};
  return {
    code: layer.barcode,
    layerNo: layer.batch_id,
    brand: product.brand || '',
    model: product.model || '',
    size: product.size || '',
    color: product.color || '',
    // The same figure the Inventory table shows on this very row — `layerSellingQuote` decides
    // which price that is — written the label's way.
    price: formatLabelPrice(layerSellingQuote(product, layer.stocking_order)),
    maxCopies: Number(layer.quantity) || 0,
  };
}
