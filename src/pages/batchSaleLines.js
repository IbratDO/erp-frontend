/**
 * The line rules of the batch-sale basket.
 *
 * Lifted out of `Sales.js` so they can be tested without loading a 3,800-line page, and because a
 * barcode scan needs to build an already-filled line in one `setBatchLines` call — adding a line
 * and then filling it cannot work, since `addBatchLine` uses a functional update and so cannot
 * hand back the new key.
 */
import { resolveLayerListPrice } from '../utils/productCost';
import { usdToUzs, uzsToUsd } from '../utils/saleCompletePayHelpers';
import { layerSellingQuote } from '../utils/inventorySelling';

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
    catalog_price: '',
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
    // What the item is priced at in the shop's own records, kept apart from `list_price` because
    // that one moves: raising the price above the shelf price makes the typed figure the new base
    // so a discount afterwards comes off it. This stays put, and is the only thing left to compare
    // against when deciding whether to warn that a sale is going out above its shelf price.
    catalog_price: formatted,
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

function parsePriceNum(str) {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Re-price every filled line into a new sale currency.
 *
 * Lifted out of the currency dropdown's own handler so the automatic flip — the one the first
 * item triggers — runs *this* code rather than a second copy of it. Two copies of a conversion
 * is how the manual path and the automatic path end up disagreeing about the same basket.
 *
 * Untouched lines stay untouched: a row with no item and no prices has nothing to convert, and
 * rewriting it would put figures in front of the seller they never entered.
 *
 * With no rate loaded the numbers are left exactly as they are. That is deliberate and
 * pre-existing — better a price in the wrong currency, which the seller sees and corrects, than
 * a silent conversion at a rate we do not have.
 */
export function convertLinesToCurrency(lines, nextCurrency, cbuRate) {
  return (lines || []).map((l) => {
    if (!l.layer && !l.list_price && !l.selling_price && !l.discount_price) return l;
    const convert = (val) => {
      const num = parsePriceNum(val);
      if (num == null) return val;
      if (!cbuRate) return val;
      const converted =
        nextCurrency === 'UZS' ? usdToUzs(num, cbuRate) : uzsToUsd(num, cbuRate);
      return formatSalePriceForCurrency(converted, nextCurrency);
    };
    return {
      ...l,
      list_price: convert(l.list_price),
      selling_price: convert(l.selling_price),
      discount_price: convert(l.discount_price),
      catalog_price: convert(l.catalog_price),
    };
  });
}

/**
 * The currency the first row's item is priced in, or null if it does not name one.
 *
 * Only the first row is asked. A basket is struck in one currency, and letting every row vote
 * would mean the last item chosen silently re-prices everything already in the basket.
 *
 * Null — rather than a guess of USD — when there is no item yet or the layer names no currency,
 * so the caller can tell "this item wants so'm" apart from "this item has nothing to say", and
 * leave the seller's own choice alone in the second case.
 */
export function currencyForLayer(layerId, inventory, products) {
  if (!layerId) return null;
  const layer = findInventoryLayer(inventory, layerId);
  if (!layer) return null;
  const product = productForLayer(layer, products);
  const quote = layerSellingQuote({ ...layer, product_detail: layer.product_detail || product });
  const currency = quote?.currency ? String(quote.currency).toUpperCase() : null;
  return currency === 'USD' || currency === 'UZS' ? currency : null;
}

/** The same question asked of a basket: what currency does its first row want? */
export function currencyForFirstLine(lines, inventory, products) {
  return currencyForLayer((lines || [])[0]?.layer, inventory, products);
}

/**
 * What the basket comes to.
 *
 * The two price columns are **per unit** — `selling_price` is what one unit costs after its
 * discount, `discount_price` is what came off one unit — so both have to be multiplied by the
 * quantity before they mean anything as a total. Summing the columns as they appear on screen
 * would understate a basket of five pairs by a factor of five, and would look plausible while
 * doing it.
 *
 * Only rows with an item count. A half-filled row is the seller mid-thought, not a line of the
 * sale, and folding it in would make the total jump about as they work.
 *
 * `amount` is what the customer pays. `discount` is what they were let off, which is worth
 * showing beside it — a basket can be discounted heavily one line at a time without anybody
 * noticing the size of it until the day is totalled up.
 */
export function batchLineTotals(lines) {
  let quantity = 0;
  let amount = 0;
  let discount = 0;
  let filledLines = 0;

  for (const l of lines || []) {
    if (!l?.layer) continue;
    filledLines += 1;
    const qty = parseInt(l.quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    quantity += qty;
    const unit = parsePriceNum(l.selling_price);
    if (unit != null && unit > 0) amount += unit * qty;
    const off = parsePriceNum(l.discount_price);
    if (off != null && off > 0) discount += off * qty;
  }

  return { quantity, amount, discount, filledLines };
}

/**
 * Lines being sold for more than the shop's own price for them.
 *
 * Selling above the shelf price is legitimate — a scarce size, a rush, a customer who wants it
 * today — and it is now allowed. But the commonest way to type a price above list is an extra
 * zero, and 2 790 instead of 279 reads as a perfectly ordinary sale afterwards: nothing is short,
 * nothing fails to balance, and revenue is ten times what it should be. So the seller is asked
 * once, before it is saved.
 *
 * Compared against `catalog_price`, which is fixed when the item is chosen and never moves,
 * rather than `list_price`, which rises to whatever was typed so a later discount comes off the
 * right figure.
 *
 * Returns one entry per line so the message can name them; an empty array means nothing to ask.
 */
export function linesPricedAboveCatalogue(lines) {
  const above = [];
  for (const l of lines || []) {
    if (!l?.layer) continue;
    const asked = parsePriceNum(l.selling_price);
    const shelf = parsePriceNum(l.catalog_price);
    if (asked == null || shelf == null || shelf <= 0) continue;
    // A hair over is rounding from a currency flip, not a decision. Only a real difference asks.
    if (asked - shelf > 0.005) {
      above.push({ key: l.key, asked, shelf, over: asked - shelf });
    }
  }
  return above;
}
