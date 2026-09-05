/**
 * What the basket comes to, at the bottom of the new-sale form.
 *
 * The trap here is that the two price columns are **per unit**: `selling_price` is what one unit
 * costs after its discount, `discount_price` is what came off one unit. Adding the columns up as
 * they appear on screen would understate a basket of five pairs by a factor of five — and would
 * look entirely plausible while doing it, which is the dangerous kind of wrong for a number the
 * seller reads out to a customer.
 */
import { batchLineTotals } from './batchSaleLines';

const line = (over = {}) => ({
  key: 'a', layer: 1, quantity: '1',
  list_price: '', selling_price: '', discount_price: '', ...over,
});

describe('the money', () => {
  it('multiplies the per-unit price by the quantity', () => {
    // The whole point: three pairs at $100 is $300, not $100.
    expect(batchLineTotals([line({ quantity: '3', selling_price: '100' })]).amount).toBe(300);
  });

  it('adds the lines together', () => {
    const lines = [
      line({ quantity: '2', selling_price: '100' }),
      line({ key: 'b', quantity: '1', selling_price: '235' }),
    ];
    expect(batchLineTotals(lines).amount).toBe(435);
  });

  it('totals the discount per unit too', () => {
    expect(batchLineTotals([line({ quantity: '4', discount_price: '5' })]).discount).toBe(20);
  });

  it('keeps the price and the discount apart', () => {
    // `selling_price` is already net of the discount, so the two are not added or subtracted —
    // the amount is what is paid, the discount is what was let off.
    const t = batchLineTotals([line({ quantity: '2', selling_price: '90', discount_price: '10' })]);
    expect(t.amount).toBe(180);
    expect(t.discount).toBe(20);
  });

  it('handles a comma as the decimal point', () => {
    // The seller's keyboard may produce one; the line editor already accepts it.
    expect(batchLineTotals([line({ quantity: '2', selling_price: '9,50' })]).amount).toBe(19);
  });
});

describe('the quantity', () => {
  it('adds up the units', () => {
    const lines = [line({ quantity: '3' }), line({ key: 'b', quantity: '2' })];
    expect(batchLineTotals(lines).quantity).toBe(5);
  });

  it('counts the filled lines separately from the units', () => {
    const lines = [line({ quantity: '3' }), line({ key: 'b', quantity: '2' })];
    expect(batchLineTotals(lines).filledLines).toBe(2);
  });
});

describe('rows that are not yet a sale', () => {
  it('ignores a row with no item chosen', () => {
    // A half-filled row is the seller mid-thought. Folding it in would make the total jump about
    // as they work.
    const lines = [line({ quantity: '2', selling_price: '100' }), line({ key: 'b', layer: '' })];
    const t = batchLineTotals(lines);
    expect(t.amount).toBe(200);
    expect(t.filledLines).toBe(1);
  });

  it('ignores a price typed on a row with no item', () => {
    const lines = [line({ key: 'b', layer: '', quantity: '9', selling_price: '999' })];
    expect(batchLineTotals(lines)).toMatchObject({ amount: 0, quantity: 0, filledLines: 0 });
  });

  it('counts an item with no price yet as a line, but adds nothing', () => {
    // Chosen but not yet priced — the row exists, the money does not.
    const t = batchLineTotals([line({ quantity: '2', selling_price: '' })]);
    expect(t.filledLines).toBe(1);
    expect(t.quantity).toBe(2);
    expect(t.amount).toBe(0);
  });

  it.each([[''], ['0'], ['abc'], [null], [undefined]])(
    'adds nothing for a %j quantity', (qty) => {
      expect(batchLineTotals([line({ quantity: qty, selling_price: '100' })]).amount).toBe(0);
    },
  );

  it.each([[''], ['0'], ['abc'], ['-5'], [null]])(
    'adds nothing for a %j price', (price) => {
      expect(batchLineTotals([line({ quantity: '2', selling_price: price })]).amount).toBe(0);
    },
  );
});

describe('an empty basket', () => {
  it.each([[[]], [null], [undefined]])('totals to nothing for %j', (lines) => {
    expect(batchLineTotals(lines)).toEqual({
      quantity: 0, amount: 0, discount: 0, filledLines: 0,
    });
  });

  it('survives a malformed row', () => {
    expect(() => batchLineTotals([null, undefined, {}])).not.toThrow();
  });
});

describe('a realistic basket', () => {
  it('adds up the way the seller would on paper', () => {
    const lines = [
      // 2 pairs at 1 900 000 so'm, 100 000 off each
      line({ quantity: '2', selling_price: '1800000', discount_price: '100000' }),
      // 1 at 950 000, no discount
      line({ key: 'b', quantity: '1', selling_price: '950000' }),
      // an empty row the seller has not filled yet
      line({ key: 'c', layer: '' }),
    ];
    expect(batchLineTotals(lines)).toEqual({
      quantity: 3,
      amount: 4550000,      // 2 × 1 800 000 + 950 000
      discount: 200000,     // 2 × 100 000
      filledLines: 2,
    });
  });
});
