/**
 * The first item in the basket decides what currency the sale is struck in.
 *
 * The shop prices some stock in dollars and some in so'm. The seller used to pick an item and
 * then have to remember to move the dropdown to match it — and when they forgot, the sale went
 * through in the wrong currency at a converted price, which is a real mis-priced sale rather than
 * a cosmetic slip.
 *
 * Two rules, and the second is the one that keeps it predictable:
 *
 *   * the **first row** decides, and only the first row. A basket is struck in one currency, so
 *     letting every row vote would mean the last item added silently re-prices everything already
 *     in the basket;
 *   * an item that names no currency of its own decides nothing, and the seller's choice stands.
 */
import {
  applyLayerToLine,
  convertLinesToCurrency,
  currencyForFirstLine,
  currencyForLayer,
} from './batchSaleLines';

const RATE = 12000;

const inventory = [
  // Priced on the layer itself, in so'm.
  {
    batch_id: 1, product: 10, quantity: 5,
    selling_price: '1900000', selling_price_currency: 'UZS',
    product_detail: { id: 10, brand: 'On', model: 'Runner', selling_price: '150' },
  },
  // Priced on the layer, in dollars.
  {
    batch_id: 2, product: 11, quantity: 5,
    selling_price: '235', selling_price_currency: 'USD',
    product_detail: { id: 11, brand: 'On', model: 'Tee', selling_price: '40' },
  },
  // No price of its own; falls back to the product, which is dollars.
  {
    batch_id: 3, product: 12, quantity: 5,
    product_detail: { id: 12, brand: 'On', model: 'Cap', selling_price: '20' },
  },
  // Nothing anywhere names a price.
  { batch_id: 4, product: 13, quantity: 5, product_detail: { id: 13, brand: 'On', model: 'Sock' } },
];

const line = (over = {}) => ({
  key: 'a', layer: '', list_price: '', selling_price: '', discount_price: '', ...over,
});

describe('what currency an item asks for', () => {
  it('reads a soum price off the layer', () => {
    expect(currencyForLayer(1, inventory, [])).toBe('UZS');
  });

  it('reads a dollar price off the layer', () => {
    expect(currencyForLayer(2, inventory, [])).toBe('USD');
  });

  it('falls back to the product when the layer has no price', () => {
    expect(currencyForLayer(3, inventory, [])).toBe('USD');
  });

  it('asks for nothing when no price exists anywhere', () => {
    // Null, not a guess of USD — so the caller can leave the seller's own choice alone.
    expect(currencyForLayer(4, inventory, [])).toBeNull();
  });

  it.each([['', null], [undefined, null], [999, null]])(
    'asks for nothing for a missing layer %j', (id) => {
      expect(currencyForLayer(id, inventory, [])).toBeNull();
    },
  );
});

describe('only the first row is asked', () => {
  it('takes the first row’s currency', () => {
    const lines = [line({ layer: 1 }), line({ key: 'b', layer: 2 })];
    expect(currencyForFirstLine(lines, inventory, [])).toBe('UZS');
  });

  it('ignores what the later rows want', () => {
    // Row two is a dollar item; it must not pull the basket back to dollars.
    const lines = [line({ layer: 1 }), line({ key: 'b', layer: 2 })];
    expect(currencyForFirstLine(lines, inventory, [])).not.toBe('USD');
  });

  it('asks for nothing while the first row is still empty', () => {
    expect(currencyForFirstLine([line(), line({ key: 'b', layer: 1 })], inventory, [])).toBeNull();
  });

  it.each([[[]], [null], [undefined]])('survives %j', (lines) => {
    expect(currencyForFirstLine(lines, inventory, [])).toBeNull();
  });
});

describe('converting the rows already in the basket', () => {
  /**
   * The flip reuses the currency dropdown's own conversion rather than a second copy of it, so
   * the automatic path and the manual path can never disagree about the same basket. These pin
   * the behaviour the dropdown already had.
   */
  it('converts dollars to soum at the rate', () => {
    const [row] = convertLinesToCurrency(
      [line({ layer: 2, list_price: '100', selling_price: '100' })], 'UZS', RATE,
    );
    expect(row.list_price).toBe('1200000');
    expect(row.selling_price).toBe('1200000');
  });

  it('converts soum back to dollars', () => {
    const [row] = convertLinesToCurrency([line({ layer: 1, selling_price: '1200000' })], 'USD', RATE);
    expect(row.selling_price).toBe('100');
  });

  it('converts the discount too, since it is money on the same row', () => {
    const [row] = convertLinesToCurrency([line({ layer: 2, discount_price: '10' })], 'UZS', RATE);
    expect(row.discount_price).toBe('120000');
  });

  it('leaves an untouched row alone', () => {
    // No item, no prices: nothing to convert, and rewriting it would put figures in front of the
    // seller that they never entered.
    const empty = line();
    expect(convertLinesToCurrency([empty], 'UZS', RATE)[0]).toBe(empty);
  });

  it('leaves the numbers as they are when no rate has loaded', () => {
    // Deliberate and pre-existing: better a price in the wrong currency, which the seller sees
    // and corrects, than a silent conversion at a rate we do not have.
    const [row] = convertLinesToCurrency([line({ layer: 2, selling_price: '100' })], 'UZS', null);
    expect(row.selling_price).toBe('100');
  });

  it('rounds soum to whole units and dollars to cents', () => {
    const [uzs] = convertLinesToCurrency([line({ layer: 2, selling_price: '9.99' })], 'UZS', RATE);
    expect(uzs.selling_price).toBe('119880');
    const [usd] = convertLinesToCurrency([line({ layer: 1, selling_price: '119880' })], 'USD', RATE);
    expect(usd.selling_price).toBe('9.99');
  });

  it.each([[[]], [null], [undefined]])('survives %j', (lines) => {
    expect(convertLinesToCurrency(lines, 'UZS', RATE)).toEqual([]);
  });
});

describe('why the flip happens before the item is applied', () => {
  /**
   * Ordering, and why it is not an implementation detail.
   *
   * Swapping the first row's item for one priced in the other currency does two things at once:
   * the basket flips, and the row is re-filled. If the row were filled first and converted after,
   * its price would be the *old* item's figure run through the rate. Converting first and filling
   * second means the new item's own price wins outright.
   *
   * The rows already in the basket have no new item to read from, so for them conversion is the
   * only answer available — which is why both steps exist rather than one.
   */
  it('the new item’s own price wins over the converted old one', () => {
    // The first row holds a $235 item; the seller swaps it for the 1 900 000 so’m one.
    const before = line({ key: 'a', layer: 2, list_price: '235', selling_price: '235' });

    const converted = convertLinesToCurrency([before], 'UZS', RATE)[0];
    expect(converted.selling_price).toBe('2820000'); // the old item, through the rate

    const after = applyLayerToLine(converted, 1, {
      inventory, products: [], saleCurrency: 'UZS', cbuRate: RATE,
    });
    expect(after.selling_price).toBe('1900000'); // the new item, read from its own layer
  });

  it('the same swap in the other direction', () => {
    const before = line({ key: 'a', layer: 1, list_price: '1900000', selling_price: '1900000' });
    const converted = convertLinesToCurrency([before], 'USD', RATE)[0];
    const after = applyLayerToLine(converted, 2, {
      inventory, products: [], saleCurrency: 'USD', cbuRate: RATE,
    });
    expect(after.selling_price).toBe('235');
  });

  it('a first pick into an empty row is untouched by the conversion', () => {
    // An empty row has no item and no prices, so there is nothing to convert — it is filled
    // natively and only natively.
    const empty = line({ key: 'a' });
    expect(convertLinesToCurrency([empty], 'UZS', RATE)[0]).toBe(empty);
    const after = applyLayerToLine(empty, 1, {
      inventory, products: [], saleCurrency: 'UZS', cbuRate: RATE,
    });
    expect(after.selling_price).toBe('1900000');
  });
});
