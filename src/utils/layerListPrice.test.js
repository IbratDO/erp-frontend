/**
 * The price the sale form pre-fills, and why it must agree with the shelf.
 *
 * `layerSellingQuote` decides what Ombor displays; `resolveLayerListPrice` decides what the sale
 * form offers at the counter. They are separate functions because the sale form also has to
 * convert into the currency the sale is being struck in — but they must consult the same three
 * sources in the same order. If they disagree, a re-priced shelf line would sell at its old
 * price, and nobody would notice until the month's profit came out wrong.
 */
import { layerSalePickerLabel, resolveLayerListPrice } from './productCost';
import { layerSellingQuote } from './inventorySelling';

const product = { selling_price: '120', selling_price_currency: 'USD' };
const RATE = 12000;

const layer = (over = {}) => ({ batch_id: 1, ...over });

describe('a layer with its own price', () => {
  it('wins over the product', () => {
    const l = layer({ selling_price: '145' });
    expect(resolveLayerListPrice(l, product, 'USD', RATE)).toBe(145);
  });

  it('wins over the stocking order', () => {
    const l = layer({
      selling_price: '250',
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    expect(resolveLayerListPrice(l, product, 'USD', RATE)).toBe(250);
  });

  it('converts into the currency the sale is struck in', () => {
    const l = layer({ selling_price: '100', selling_price_currency: 'USD' });
    expect(resolveLayerListPrice(l, product, 'UZS', RATE)).toBe(1200000);
  });

  it('converts the other way too', () => {
    const l = layer({ selling_price: '1200000', selling_price_currency: 'UZS' });
    expect(resolveLayerListPrice(l, product, 'USD', RATE)).toBe(100);
  });

  it('uses the figure as-is when no rate has loaded', () => {
    // Better a price in the wrong currency, which the seller sees and corrects, than a silent
    // conversion at a rate we do not have.
    const l = layer({ selling_price: '100', selling_price_currency: 'USD' });
    expect(resolveLayerListPrice(l, product, 'UZS', null)).toBe(100);
  });
});

describe('the dropdown row in the sale form', () => {
  /**
   * The fourth place the price is shown, and the one that was missed: the picker used to work the
   * figure out for itself, asking the stocking order first. A re-priced layer therefore advertised
   * its old price in the dropdown while the form below filled in the new one — two numbers on one
   * screen disagreeing, which is worse than either being wrong.
   */
  const pickerProduct = {
    id: 1789, brand: 'On', model: 'Cloudrunner 3', size: '42', color: 'Black',
    selling_price: '120', selling_price_currency: 'USD',
  };

  it("shows the layer's own price, not the order's", () => {
    const l = layer({
      selling_price: '250',
      quantity: 1,
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    const label = layerSalePickerLabel(pickerProduct, l);
    expect(label).toContain('$250.00');
    expect(label).not.toContain('$235.00');
  });

  it('agrees with what the form pre-fills', () => {
    // The assertion that keeps the two in step: same layer, same number, two code paths.
    const l = layer({
      selling_price: '250',
      quantity: 1,
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    expect(layerSalePickerLabel(pickerProduct, l)).toContain('$250.00');
    expect(resolveLayerListPrice(l, pickerProduct, 'USD', RATE)).toBe(250);
  });

  it('agrees with what the Ombor table shows', () => {
    const l = layer({ selling_price: '250', quantity: 1, product_detail: pickerProduct });
    expect(layerSalePickerLabel(pickerProduct, l))
      .toContain(String(layerSellingQuote(l).amount.toFixed(2)));
  });

  it('still falls back to the order when the layer has no price of its own', () => {
    const l = layer({
      quantity: 1,
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    expect(layerSalePickerLabel(pickerProduct, l)).toContain('$235.00');
  });

  it('still shows the stock count and the layer number', () => {
    const l = layer({ selling_price: '250', quantity: 3, batch_id: 1213 });
    const label = layerSalePickerLabel(pickerProduct, l);
    expect(label).toContain('Layer #1213');
    expect(label).toContain('3 in stock');
  });

  it('prints a soum price in soum rather than giving up', () => {
    const l = layer({ selling_price: '1900000', selling_price_currency: 'UZS', quantity: 1 });
    expect(layerSalePickerLabel(pickerProduct, l)).toContain("so'm");
  });
});

describe('a layer without one behaves exactly as before', () => {
  it('takes the order price', () => {
    const l = layer({ stocking_order: { ordered_quantity: 2, selling_usd_cash: '300' } });
    expect(resolveLayerListPrice(l, product, 'USD', RATE)).toBe(150);
  });

  it('falls through to the product', () => {
    expect(resolveLayerListPrice(layer(), product, 'USD', RATE)).toBe(120);
  });

  it.each([['0'], [''], ['abc'], [null]])('ignores a %j layer price', (bad) => {
    const l = layer({ selling_price: bad });
    expect(resolveLayerListPrice(l, product, 'USD', RATE)).toBe(120);
  });

  it('returns nothing when no source has a price', () => {
    expect(resolveLayerListPrice(layer(), {}, 'USD', RATE)).toBeNull();
  });
});
