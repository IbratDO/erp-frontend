/**
 * Spotting a nasiya sale in the list.
 *
 * The rule itself is small; what makes it worth pinning is where it is *applied*. Both group rows
 * paint their own background on the cells (`.sale-group-row td`, `.sale-group-detail-row td`),
 * and a cell's background covers the row's — so the old code, which computed the right colour and
 * set it on the `<tr>`, was painted over on every single group. A credit group had never once
 * looked like one, and nothing failed to say so.
 *
 * These tests cover the decision. The application is CSS specificity, checked in the stylesheet:
 * every tone rule is one class more specific than the structural rule it has to beat.
 */
import { groupRowTone, saleRowTone } from './Sales';

const sale = (over = {}) => ({ id: 1, credit_amount: null, balance_shortfall_type: null, ...over });

describe('a single sale', () => {
  it('is credit when it carries a credit amount', () => {
    expect(saleRowTone(sale({ credit_amount: '15.00' }))).toBe('credit');
  });

  it('is credit on an older row that only carries the shortfall type', () => {
    // Rows written before `credit_amount` existed kept the figure under the shortfall fields.
    // They are still in the database and must still show up as debts.
    expect(saleRowTone(sale({ balance_shortfall_type: 'on_credit' }))).toBe('credit');
  });

  it('is a discount when the gap was forgiven rather than owed', () => {
    expect(saleRowTone(sale({ balance_shortfall_type: 'discount' }))).toBe('discount');
  });

  it('is plain when it was simply paid for', () => {
    expect(saleRowTone(sale())).toBeNull();
  });

  it.each([['0'], [''], ['0.00'], [null], ['abc']])(
    'is not credit for a %j credit amount', (amount) => {
      expect(saleRowTone(sale({ credit_amount: amount }))).toBeNull();
    },
  );

  it('prefers credit when a sale is both', () => {
    // Part forgiven and part owed is a real combination. What is still owed is the more important
    // fact about the row, so that is what the colour says.
    const both = sale({ credit_amount: '10', balance_shortfall_type: 'discount' });
    expect(saleRowTone(both)).toBe('credit');
  });

  it.each([[null], [undefined]])('survives %j', (bad) => {
    expect(saleRowTone(bad)).toBeNull();
  });
});

describe('a group', () => {
  it('is credit when any line in it was sold on nasiya', () => {
    // The heading has to carry it: a group is collapsed by default, so a debt buried on line
    // three would otherwise be invisible until somebody opened it.
    const lines = [sale(), sale({ id: 2, credit_amount: '5' }), sale({ id: 3 })];
    expect(groupRowTone(lines)).toBe('credit');
  });

  it('is credit even when another line was discounted', () => {
    const lines = [sale({ id: 1, balance_shortfall_type: 'discount' }), sale({ id: 2, credit_amount: '5' })];
    expect(groupRowTone(lines)).toBe('credit');
  });

  it('is a discount when that is all there is', () => {
    const lines = [sale(), sale({ id: 2, balance_shortfall_type: 'discount' })];
    expect(groupRowTone(lines)).toBe('discount');
  });

  it('is plain when every line was paid for', () => {
    expect(groupRowTone([sale(), sale({ id: 2 })])).toBeNull();
  });

  it.each([[[]], [null], [undefined]])('survives %j', (lines) => {
    expect(groupRowTone(lines)).toBeNull();
  });

  it('does not care which line carries the debt', () => {
    const first = [sale({ id: 1, credit_amount: '5' }), sale({ id: 2 })];
    const last = [sale({ id: 1 }), sale({ id: 2, credit_amount: '5' })];
    expect(groupRowTone(first)).toBe(groupRowTone(last));
  });
});
