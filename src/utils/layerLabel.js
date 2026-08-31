import { inventorySellingCell } from './inventorySelling';

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
    // The price the Inventory table is showing on this very row, minus its per-unit suffix —
    // the label has no room for "/u" and no need for it, since a sticker is one box.
    price: String(inventorySellingCell(product, layer.stocking_order) || '').replace(/\/u$/, ''),
    maxCopies: Number(layer.quantity) || 0,
  };
}
