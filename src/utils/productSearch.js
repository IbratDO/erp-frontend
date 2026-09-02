/** Case-insensitive: every whitespace-separated term appears in id/category/brand/model/size/color. */
export function productMatchesSearch(product, rawQuery) {
  const raw = String(rawQuery || '').trim().toLowerCase();
  if (!raw) return true;
  const terms = raw.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  if (!product) return false;
  const blob = [
    product.id,
    product.category,
    product.brand,
    product.model,
    product.size,
    product.color,
  ]
    .filter((x) => x != null && x !== '')
    .map((x) => String(x).toLowerCase())
    .join(' ');
  return terms.every((t) => blob.includes(t));
}

/**
 * The same search, for a picker whose rows are FIFO layers rather than products.
 *
 * The sale form lists one row per layer and labels each "Layer #1213", but the search only ever
 * looked at the *product* — so the one number printed on the row, and on the sticker stuck to
 * the box in the operator's hand, was the one thing that would not find it. Now that labels are
 * printed and scanned, the layer number is how staff refer to stock out loud.
 *
 * Both of the layer's identifiers are searchable, and one query finds either: the barcode is the
 * padded form of the number, so typing `1213` matches `LD00001213` as a substring, and scanning
 * the full code matches it outright.
 *
 * The product's own fields stay in the blob, so brand, model, size and colour keep working
 * exactly as before — this only widens what counts as a match.
 */
export function layerMatchesSearch(item, rawQuery) {
  const raw = String(rawQuery || '').trim().toLowerCase();
  if (!raw) return true;
  const layer = item?.layer;
  if (!layer) return productMatchesSearch(item?.product, rawQuery);

  const terms = raw.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const product = item.product || {};
  const blob = [
    layer.batch_id,
    layer.barcode,
    product.id,
    product.category,
    product.brand,
    product.model,
    product.size,
    product.color,
  ]
    .filter((x) => x != null && x !== '')
    .map((x) => String(x).toLowerCase())
    .join(' ');
  return terms.every((t) => blob.includes(t));
}
