/**
 * Charging more than the shelf price.
 *
 * The final price used to be clamped to the list price, so typing more than the shelf price
 * silently snapped back down: a shop selling a scarce size for more than it lists simply could
 * not record what it charged, and nothing said why the number had changed.
 *
 * Two rules come with allowing it, and both are here:
 *
 *   * **the list rises to meet the price**, so a discount entered afterwards comes off what was
 *     charged rather than off the old shelf figure — otherwise 300 then a 10 discount lands on
 *     269 and the 300 disappears with no explanation;
 *   * **the shop's own price is remembered separately**, because the commonest way to type a
 *     price above list is an extra zero, and 2 790 instead of 279 reads as a perfectly ordinary
 *     sale afterwards. Nothing is short, nothing fails to balance, and revenue is ten times what
 *     it should be.
 */
import { applyLayerToLine, convertLinesToCurrency, linesPricedAboveCatalogue } from './batchSaleLines';

const RATE = 12000;
const inventory = [{
  batch_id: 1, product: 10, quantity: 5,
  selling_price: '279', selling_price_currency: 'USD',
  product_detail: { id: 10, brand: 'On', model: 'Cloud', selling_price: '279' },
}];

const line = (over = {}) => ({
  key: 'a', layer: 1, quantity: '1',
  list_price: '279', selling_price: '279', discount_price: '', catalog_price: '279', ...over,
});

describe('the item remembers what the shop charges for it', () => {
  it('records the shelf price when the item is chosen', () => {
    const filled = applyLayerToLine({ key: 'a' }, 1, {
      inventory, products: [], saleCurrency: 'USD', cbuRate: RATE,
    });
    expect(filled.catalog_price).toBe('279');
    expect(filled.selling_price).toBe('279');
  });

  it('keeps it through a currency flip, so the comparison is like for like', () => {
    // Without this the check would compare a soum price against a dollar one and fire on every
    // single line the moment the basket flipped.
    const [row] = convertLinesToCurrency([line()], 'UZS', RATE);
    expect(row.catalog_price).toBe('3348000');
    expect(row.selling_price).toBe('3348000');
  });
});

describe('when the price is above the shelf price', () => {
  it('notices', () => {
    const above = linesPricedAboveCatalogue([line({ selling_price: '300' })]);
    expect(above).toHaveLength(1);
    expect(above[0]).toMatchObject({ asked: 300, shelf: 279 });
  });

  it('catches the extra zero, which is the reason it exists', () => {
    const above = linesPricedAboveCatalogue([line({ selling_price: '2790' })]);
    expect(above[0].over).toBe(2511);
  });

  it('names every line that is above, not just the first', () => {
    const lines = [
      line({ key: 'a', selling_price: '300' }),
      line({ key: 'b', selling_price: '279' }),
      line({ key: 'c', selling_price: '400' }),
    ];
    expect(linesPricedAboveCatalogue(lines).map((r) => r.key)).toEqual(['a', 'c']);
  });
});

describe('when it is not', () => {
  it.each([['279'], ['250'], ['0'], ['']])('says nothing for a price of %j', (price) => {
    expect(linesPricedAboveCatalogue([line({ selling_price: price })])).toEqual([]);
  });

  it('ignores a rounding hair left by a currency flip', () => {
    // A cent over is arithmetic, not a decision, and asking about it every time would train the
    // seller to click through the warning without reading it.
    expect(linesPricedAboveCatalogue([line({ selling_price: '279.004' })])).toEqual([]);
  });

  it('ignores a row with no item chosen', () => {
    expect(linesPricedAboveCatalogue([line({ layer: '', selling_price: '999' })])).toEqual([]);
  });

  it('ignores a row whose shelf price is unknown', () => {
    // Nothing to compare against is not the same as "above"; asking would be noise.
    expect(linesPricedAboveCatalogue([line({ catalog_price: '', selling_price: '999' })])).toEqual([]);
  });

  it.each([[[]], [null], [undefined]])('survives %j', (lines) => {
    expect(linesPricedAboveCatalogue(lines)).toEqual([]);
  });

  it('survives a malformed row', () => {
    expect(() => linesPricedAboveCatalogue([null, {}, undefined])).not.toThrow();
  });
});
