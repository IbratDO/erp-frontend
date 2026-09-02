/**
 * Finding a shelf line in the sale form's picker.
 *
 * The picker lists one row per FIFO layer and prints "Layer #1213" on each. That number is also
 * on the sticker on the box, so it is what staff say to each other and what they reach for first
 * — and it was the one thing the search could not find, because the search only ever looked at
 * the product behind the row.
 */
import { layerMatchesSearch, productMatchesSearch } from './productSearch';

const product = {
  id: 42, category: 'Krossovka', brand: 'On', model: 'Cloudrunner 3', size: '42', color: 'Qora',
};
const item = (over = {}) => ({
  product,
  layer: { batch_id: 1213, barcode: 'LD00001213', ...over },
});

describe('searching a layer by its number', () => {
  it('finds it by the number printed on the row', () => {
    expect(layerMatchesSearch(item(), '1213')).toBe(true);
  });

  it('finds it by the full barcode, as a scanner sends it', () => {
    expect(layerMatchesSearch(item(), 'LD00001213')).toBe(true);
  });

  it('does not care about the case of a scanned code', () => {
    expect(layerMatchesSearch(item(), 'ld00001213')).toBe(true);
  });

  it('does not match a different layer', () => {
    expect(layerMatchesSearch(item(), '9999')).toBe(false);
  });

  it('distinguishes the layer number from the product id', () => {
    // Both are numbers on the same row; searching one must not silently return the other.
    const l = item();
    expect(layerMatchesSearch(l, '1213')).toBe(true);
    expect(layerMatchesSearch(l, '42')).toBe(true); // the product id, and also the size
    expect(layerMatchesSearch(l, '77')).toBe(false);
  });
});

describe('everything that already worked still works', () => {
  it.each([
    ['on'], ['cloudrunner'], ['qora'], ['krossovka'], ['On Cloudrunner'],
  ])('still finds it by %j', (query) => {
    expect(layerMatchesSearch(item(), query)).toBe(true);
  });

  it('still requires every term to match', () => {
    expect(layerMatchesSearch(item(), 'On Nike')).toBe(false);
  });

  it('combines a layer number with a product term', () => {
    expect(layerMatchesSearch(item(), '1213 On')).toBe(true);
    expect(layerMatchesSearch(item(), '1213 Nike')).toBe(false);
  });

  it('returns everything for an empty query', () => {
    ['', '   ', null, undefined].forEach((q) => {
      expect(layerMatchesSearch(item(), q)).toBe(true);
    });
  });
});

describe('rows that are not layers', () => {
  it('falls back to the plain product search when there is no layer', () => {
    // The picker is also used for product rows; those must behave exactly as before.
    expect(layerMatchesSearch({ product }, 'cloudrunner')).toBe(true);
    expect(layerMatchesSearch({ product }, '1213')).toBe(false);
  });

  it('survives a layer with no barcode', () => {
    // Possible on a layer created before barcodes existed and never backfilled.
    const l = item({ barcode: null });
    expect(layerMatchesSearch(l, '1213')).toBe(true);
    expect(layerMatchesSearch(l, 'LD00001213')).toBe(false);
  });

  it.each([[null], [undefined], [{}]])('does not throw on %j', (bad) => {
    expect(() => layerMatchesSearch(bad, 'on')).not.toThrow();
  });
});

describe('the product-only search is unchanged', () => {
  it.each([['on'], ['42'], ['qora'], ['On Qora']])('matches %j', (q) => {
    expect(productMatchesSearch(product, q)).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(productMatchesSearch(product, 'nike')).toBe(false);
  });
});
