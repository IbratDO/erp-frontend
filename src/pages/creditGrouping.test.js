/**
 * Grouping the Qarzdorlik page by customer.
 *
 * The heading states a figure the shop will chase somebody for, so what it counts is worth
 * pinning directly rather than through the markup: which debts land under which name, what
 * counts towards the total, and what happens when one customer owes in two currencies.
 */
import {
  creditGroupBackground,
  groupCreditsByCustomer,
  isOpenCredit,
} from './CreditSales';

const debt = (over = {}) => ({
  id: 1,
  customer_name: 'Ali',
  currency: 'USD',
  status: 'unpaid',
  principal_amount: '100',
  paid_amount: '0',
  remaining_amount: '100',
  days_until_due: 30,
  ...over,
});

const byName = (groups, name) => groups.find((g) => g.name === name);

describe('which rows land under which name', () => {
  test('one heading per customer, in the order the rows arrived', () => {
    const groups = groupCreditsByCustomer([
      debt({ id: 1, customer_name: 'Bek' }),
      debt({ id: 2, customer_name: 'Ali' }),
      debt({ id: 3, customer_name: 'Bek' }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Bek', 'Ali']);
    expect(byName(groups, 'Bek').rows.map((r) => r.id)).toEqual([1, 3]);
  });

  test('a debt with no customer still gets a heading rather than disappearing', () => {
    const groups = groupCreditsByCustomer([debt({ customer_name: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('—');
  });

  test('no rows, no groups', () => {
    expect(groupCreditsByCustomer([])).toEqual([]);
    expect(groupCreditsByCustomer(null)).toEqual([]);
  });
});

describe('what the heading counts', () => {
  test('principal, paid and remaining add up across a customer\'s open debts', () => {
    const groups = groupCreditsByCustomer([
      debt({ id: 1, principal_amount: '100', paid_amount: '40', remaining_amount: '60', status: 'partial' }),
      debt({ id: 2, principal_amount: '50', paid_amount: '0', remaining_amount: '50' }),
    ]);
    expect(byName(groups, 'Ali').openTotals.USD).toEqual({
      principal: 150, paid: 40, remaining: 110,
    });
    expect(byName(groups, 'Ali').openCount).toBe(2);
  });

  test('a settled debt still shows underneath but adds nothing to the total', () => {
    const groups = groupCreditsByCustomer([
      debt({ id: 1, status: 'paid', principal_amount: '80', paid_amount: '80', remaining_amount: '0' }),
      debt({ id: 2, principal_amount: '50', remaining_amount: '50' }),
    ]);
    const ali = byName(groups, 'Ali');
    expect(ali.rows).toHaveLength(2);
    expect(ali.openCount).toBe(1);
    expect(ali.openTotals.USD.principal).toBe(50);
  });

  test('a forgiven debt is not chased either', () => {
    const groups = groupCreditsByCustomer([debt({ status: 'waived', remaining_amount: '0' })]);
    expect(byName(groups, 'Ali').openCount).toBe(0);
    expect(byName(groups, 'Ali').openTotals).toEqual({});
  });

  test('only unpaid and partial count as open', () => {
    expect(isOpenCredit(debt({ status: 'unpaid' }))).toBe(true);
    expect(isOpenCredit(debt({ status: 'partial' }))).toBe(true);
    expect(isOpenCredit(debt({ status: 'paid' }))).toBe(false);
    expect(isOpenCredit(debt({ status: 'waived' }))).toBe(false);
    expect(isOpenCredit(null)).toBe(false);
  });
});

describe('a customer who owes in both currencies', () => {
  const groups = () => groupCreditsByCustomer([
    debt({ id: 1, currency: 'USD', principal_amount: '150', paid_amount: '50', remaining_amount: '100', status: 'partial' }),
    debt({ id: 2, currency: 'UZS', principal_amount: '2000000', paid_amount: '500000', remaining_amount: '1500000', status: 'partial' }),
  ]);

  test('appears once, with each currency kept apart', () => {
    const all = groups();
    expect(all).toHaveLength(1);
    expect(Object.keys(all[0].openTotals).sort()).toEqual(['USD', 'UZS']);
  });

  test('the two are never added into one number', () => {
    const ali = groups()[0];
    expect(ali.openTotals.USD).toEqual({ principal: 150, paid: 50, remaining: 100 });
    expect(ali.openTotals.UZS).toEqual({ principal: 2000000, paid: 500000, remaining: 1500000 });
  });
});

describe('the heading takes the colour of its most urgent debt', () => {
  test('one overdue item makes the whole customer read overdue', () => {
    const groups = groupCreditsByCustomer([
      debt({ id: 1, days_until_due: 40 }),
      debt({ id: 2, days_until_due: -3 }),
    ]);
    const ali = byName(groups, 'Ali');
    expect(ali.soonestDays).toBe(-3);
    expect(ali.soonestRow.id).toBe(2);
    expect(creditGroupBackground(ali)).toBe('#f8d7da');
  });

  test('due within ten days is amber', () => {
    const ali = groupCreditsByCustomer([debt({ days_until_due: 4 })])[0];
    expect(creditGroupBackground(ali)).toBe('#fff3cd');
  });

  test('comfortably ahead is left plain', () => {
    const ali = groupCreditsByCustomer([debt({ days_until_due: 40 })])[0];
    expect(creditGroupBackground(ali)).toBeUndefined();
  });

  test('nothing left owing is green', () => {
    const ali = groupCreditsByCustomer([debt({ status: 'paid', days_until_due: -9 })])[0];
    expect(creditGroupBackground(ali)).toBe('#d4edda');
  });

  test('a settled debt does not lend its date to the heading', () => {
    const ali = groupCreditsByCustomer([
      debt({ id: 1, status: 'paid', days_until_due: -30 }),
      debt({ id: 2, days_until_due: 20 }),
    ])[0];
    expect(ali.soonestDays).toBe(20);
    expect(creditGroupBackground(ali)).toBeUndefined();
  });

  test('a debt with no due date leaves the heading plain', () => {
    const ali = groupCreditsByCustomer([debt({ days_until_due: null })])[0];
    expect(ali.soonestDays).toBeNull();
    expect(creditGroupBackground(ali)).toBeUndefined();
  });
});
