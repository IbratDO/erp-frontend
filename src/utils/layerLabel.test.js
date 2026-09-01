/**
 * What a sticker says, and how it differs from what the screen says.
 *
 * The shop writes money differently on a printed label than in the tables: `120.00 y.e` rather
 * than `$120.00`, and `120 000 uzs` rather than `120,000 so'm`. Two formats, but they must never
 * be two *figures* — a label quoting a price the system does not is worse than a label with no
 * price at all. `layerSellingQuote` is the one place that decides which price a layer carries,
 * and both formatters read from it.
 */
import { formatLabelPrice, layerToLabelData } from './layerLabel';
import { inventorySellingCell, layerSellingQuote } from './inventorySelling';

const layer = (over = {}) => ({
  batch_id: 4821,
  barcode: 'LD00004821',
  quantity: 3,
  product_detail: {
    brand: 'On', model: 'club T', size: '42', color: 'Qora',
    selling_price: '120', selling_price_currency: 'USD',
  },
  ...over,
});

describe('money on a label', () => {
  it('writes dollars as y.e, with the cents kept', () => {
    expect(formatLabelPrice({ amount: 120, currency: 'USD' })).toBe('120.00 y.e');
    expect(formatLabelPrice({ amount: 279.5, currency: 'USD' })).toBe('279.50 y.e');
  });

  it('writes soum as uzs, grouped with spaces and no decimals', () => {
    expect(formatLabelPrice({ amount: 120000, currency: 'UZS' })).toBe('120 000 uzs');
    expect(formatLabelPrice({ amount: 1250000, currency: 'UZS' })).toBe('1 250 000 uzs');
    expect(formatLabelPrice({ amount: 950, currency: 'UZS' })).toBe('950 uzs');
  });

  it('groups with spaces whatever locale the printing machine is in', () => {
    // Done by hand rather than through toLocaleString on purpose: a label is a physical object
    // and must not come out with commas on one computer and spaces on another.
    expect(formatLabelPrice({ amount: 120000, currency: 'UZS' })).not.toContain(',');
  });

  it('prints nothing rather than a zero or a NaN', () => {
    [null, undefined, { amount: 0, currency: 'USD' }, { amount: NaN, currency: 'USD' }]
      .forEach((q) => expect(formatLabelPrice(q)).toBe(''));
  });
});

describe('the title line', () => {
  it('separates brand from model with a bar', () => {
    // "On club T" reads as three words with no way to tell where the brand ends.
    expect(layerToLabelData(layer())).toMatchObject({ brand: 'On', model: 'club T' });
  });

  it('carries size and colour separately', () => {
    expect(layerToLabelData(layer())).toMatchObject({ size: '42', color: 'Qora' });
  });
});

describe('label and table never disagree about the figure', () => {
  it('reads the same price the table shows, formatted differently', () => {
    const l = layer();
    const quote = layerSellingQuote(l);
    expect(quote).toMatchObject({ amount: 120, currency: 'USD', source: 'product' });
    expect(layerToLabelData(l).price).toBe('120.00 y.e');
    expect(inventorySellingCell(l)).toBe('$120.00/u');
  });

  it('agrees on a soum-priced product too', () => {
    const l = layer({
      product_detail: {
        brand: 'On', model: 'club T', size: '42', color: 'Qora',
        selling_price: '1250000', selling_price_currency: 'UZS',
      },
    });
    expect(layerToLabelData(l).price).toBe('1 250 000 uzs');
    expect(inventorySellingCell(l)).toContain("so'm");
  });

  it('prefers the order price over the product price, as the table does', () => {
    const l = layer({
      stocking_order: { ordered_quantity: 2, selling_usd_cash: '300' },
    });
    expect(layerToLabelData(l).price).toBe('150.00 y.e'); // 300 / 2
    expect(inventorySellingCell(l)).toBe('$150.00/u');
  });
});

describe('a layer that has been re-priced', () => {
  /**
   * The whole point of giving a layer its own price: it must beat both other sources, or the
   * edit saves correctly and the screen keeps showing the old figure — which is the bug the
   * field was added to remove.
   */
  it('beats the product default', () => {
    const l = layer({ selling_price: '145', selling_price_currency: 'USD' });
    expect(layerSellingQuote(l)).toMatchObject({ amount: 145, source: 'layer' });
    expect(inventorySellingCell(l)).toBe('$145.00/u');
  });

  it('beats the order price too', () => {
    // This is the case that mattered: 14 live layers take their figure from the order, and on
    // all of them the product has none. If the order won here, the button would do nothing.
    const l = layer({
      selling_price: '250',
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    expect(layerSellingQuote(l)).toMatchObject({ amount: 250, source: 'layer' });
    expect(inventorySellingCell(l)).toBe('$250.00/u');
  });

  it('reaches the printed label as well as the table', () => {
    const l = layer({ selling_price: '250' });
    expect(layerToLabelData(l).price).toBe('250.00 y.e');
  });

  it('keeps its own currency', () => {
    const l = layer({ selling_price: '1900000', selling_price_currency: 'UZS' });
    expect(layerToLabelData(l).price).toBe('1 900 000 uzs');
    expect(inventorySellingCell(l)).toContain("so'm");
  });

  it('falls back again once the price is cleared', () => {
    // Null is the way out, and must restore the previous behaviour exactly.
    const l = layer({
      selling_price: null,
      stocking_order: { ordered_quantity: 1, selling_usd_cash: '235' },
    });
    expect(layerSellingQuote(l)).toMatchObject({ amount: 235, source: 'order' });
  });

  it('ignores a zero or unparseable price rather than showing it', () => {
    ['0', '', 'abc', null].forEach((bad) => {
      const l = layer({ selling_price: bad });
      expect(layerSellingQuote(l).source).toBe('product');
    });
  });
});

describe('the table formatting this refactor must not have changed', () => {
  it.each([
    [{ selling_price: '120', selling_price_currency: 'USD' }, '$120.00/u'],
    [{ selling_price: '1250000', selling_price_currency: 'UZS' }, "1,250,000 so'm/u"],
    [{ selling_price: '0' }, '—'],
    [{}, '—'],
  ])('renders a product priced %j as %s', (product, expected) => {
    expect(inventorySellingCell({ product_detail: product })).toBe(expected);
  });
});

describe('a layer with no barcode', () => {
  it('produces no label at all rather than a blank sticker', () => {
    expect(layerToLabelData(layer({ barcode: null }))).toBeNull();
    expect(layerToLabelData(null)).toBeNull();
  });
});
