/**
 * The line rules of the batch-sale basket.
 *
 * Lifted out of `Sales.js` so they can be tested without loading a 3,800-line page, and because a
 * barcode scan needs to build an already-filled line in one `setBatchLines` call — adding a line
 * and then filling it cannot work, since `addBatchLine` uses a functional update and so cannot
 * hand back the new key.
 */
import { resolveLayerListPrice } from '../utils/productCost';

export const EMPTY_PKG_LINES = () => [{ key: `${Date.now()}`, package_type: '', quantity: 1 }];

export function findInventoryLayer(inventoryList, batchId) {
  return (inventoryList || []).find((x) => Number(x.batch_id) === Number(batchId));
}

export function productForLayer(layer, products) {
  if (!layer) return null;
  return layer.product_detail || (products || []).find((x) => Number(x.id) === Number(layer.product));
}

export function formatSalePriceForCurrency(priceNum, saleCur) {
  if (priceNum == null || !Number.isFinite(priceNum) || priceNum <= 0) return '';
  return saleCur === 'UZS' ? String(Math.round(priceNum)) : String(Number(priceNum.toFixed(2)));
}

/**
 * Strip the layer and everything priced off it, keeping what the operator chose by hand.
 *
 * `category` and `quantity` survive: they are filter and intent, not consequences of the layer.
 * Four places used to carry their own copy of this field list — opening the modal, adding a line,
 * clearing the picker, and clearing a line whose layer sold out from under it. They had already
 * drifted, and a line missing a field is one the submit handler reads as `undefined`.
 */
export function clearLayerFromLine(line) {
  return {
    ...line,
    layer: '',
    product: '',
    inventory_batch_id: '',
    list_price: '',
    selling_price: '',
    discount_price: '',
    packageLines: EMPTY_PKG_LINES(),
  };
}

/** One blank line in the basket. */
export function emptyBatchLine(key) {
  return clearLayerFromLine({
    key: key || `${Date.now()}-${Math.random()}`,
    category: '',
    quantity: '1',
  });
}

/**
 * Resolve a layer onto a line: back-fill its product, batch id, category and prices.
 *
 * The layer's own category overwrites whatever the line's filter held. That precedence is
 * deliberate — a physical box in the operator's hand outranks a dropdown they set earlier.
 */
export function applyLayerToLine(line, layerId, ctx) {
  if (!layerId) return clearLayerFromLine(line);
  const { inventory, products, saleCurrency, cbuRate } = ctx;
  const layer = findInventoryLayer(inventory, layerId);
  const product = productForLayer(layer, products);
  const formatted = formatSalePriceForCurrency(
    resolveLayerListPrice(layer, product, saleCurrency, cbuRate), saleCurrency,
  );
  return {
    ...line,
    layer: layerId,
    product: layer ? String(layer.product) : '',
    inventory_batch_id: layer ? String(layer.batch_id) : '',
    category: product?.category || line.category,
    list_price: formatted,
    selling_price: formatted,
    discount_price: '',
  };
}

/** How many units of this layer the basket already holds, across every line. */
function quantityAlreadyOnLines(lines, layerId) {
  return lines
    .filter((l) => String(l.layer) === String(layerId))
    .reduce((sum, l) => sum + (parseInt(l.quantity, 10) || 0), 0);
}

/**
 * Fold one scanned layer into the basket.
 *
 * Returns `{ lines, result }`, where `result.kind` is what the operator is told:
 *
 *   'incremented'   the layer was already on a line, so that line's quantity went up
 *   'added'         it filled the first empty line, or was appended as a new one
 *   'at-stock-cap'  the basket already holds every unit this layer has; nothing changed
 *
 * **A rescan increments rather than adding a line.** Scanning three identical boxes means
 * quantity 3 — three separate lines would become three one-unit `Sale` rows for one product,
 * which is the wrong shape for the sale group and for returns against it.
 *
 * **The cap is checked against the whole basket, not one line.** A layer split across two lines
 * (possible by hand, via the picker) could otherwise be scanned past its stock one line at a time,
 * and the server would reject the whole basket at submit — after the operator had scanned
 * everything.
 */
export function applyScanToBatchLines(lines, pickerItem, ctx) {
  const layerId = String(pickerItem.value);
  const stock = Number(pickerItem.layer?.quantity) || 0;
  const label = pickerItem.label || '';

  if (quantityAlreadyOnLines(lines, layerId) >= stock) {
    return { lines, result: { kind: 'at-stock-cap', key: null, label, stock } };
  }

  const existingIndex = lines.findIndex((l) => String(l.layer) === layerId);
  if (existingIndex !== -1) {
    const target = lines[existingIndex];
    const next = lines.slice();
    next[existingIndex] = {
      ...target,
      quantity: String((parseInt(target.quantity, 10) || 0) + 1),
    };
    return { lines: next, result: { kind: 'incremented', key: target.key, label } };
  }

  // The modal opens with one blank line, so the first scan of a sale should fill it rather than
  // leave an empty row above the one it just created.
  const emptyIndex = lines.findIndex((l) => !l.layer);
  if (emptyIndex !== -1) {
    const next = lines.slice();
    next[emptyIndex] = applyLayerToLine(lines[emptyIndex], layerId, ctx);
    return { lines: next, result: { kind: 'added', key: lines[emptyIndex].key, label } };
  }

  const appended = applyLayerToLine(emptyBatchLine(), layerId, ctx);
  return { lines: [...lines, appended], result: { kind: 'added', key: appended.key, label } };
}
