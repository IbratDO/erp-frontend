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
    const quote = layerSellingQuote(l.product_detail, l.stocking_order);
    expect(quote).toEqual({ amount: 120, currency: 'USD' });
    expect(layerToLabelData(l).price).toBe('120.00 y.e');
    expect(inventorySellingCell(l.product_detail, l.stocking_order)).toBe('$120.00/u');
  });

  it('agrees on a soum-priced product too', () => {
    const l = layer({
      product_detail: {
        brand: 'On', model: 'club T', size: '42', color: 'Qora',
        selling_price: '1250000', selling_price_currency: 'UZS',
      },
    });
    expect(layerToLabelData(l).price).toBe('1 250 000 uzs');
    expect(inventorySellingCell(l.product_detail, l.stocking_order)).toContain("so'm");
  });

  it('prefers the order price over the product price, as the table does', () => {
    const l = layer({
      stocking_order: { ordered_quantity: 2, selling_usd_cash: '300' },
    });
    expect(layerToLabelData(l).price).toBe('150.00 y.e'); // 300 / 2
    expect(inventorySellingCell(l.product_detail, l.stocking_order)).toBe('$150.00/u');
  });
});

describe('the table formatting this refactor must not have changed', () => {
  it.each([
    [{ selling_price: '120', selling_price_currency: 'USD' }, null, '$120.00/u'],
    [{ selling_price: '1250000', selling_price_currency: 'UZS' }, null, "1,250,000 so'm/u"],
    [{ selling_price: '0' }, null, '—'],
    [{}, null, '—'],
  ])('renders %j as %s', (product, order, expected) => {
    expect(inventorySellingCell(product, order)).toBe(expected);
  });
});

describe('a layer with no barcode', () => {
  it('produces no label at all rather than a blank sticker', () => {
    expect(layerToLabelData(layer({ barcode: null }))).toBeNull();
    expect(layerToLabelData(null)).toBeNull();
  });
});
