/**
 * Grouping debts by customer, and the colour that says how urgent one is.
 *
 * These are the parts of the Debitorlik rework that are arithmetic rather than markup: which
 * rows land under which heading, what a group is owed, and where the amber and red bands fall.
 * Worth testing directly because the group header states a total the shop will chase someone
 * for, and because the colour is the only thing on the page that says "this one is late".
 */
import {
  groupReceivablesByCustomer,
  groupRowBackground,
  receivableDaysUntilDue,
  receivableDueDate,
  receivableRowBackground,
} from './ReceivablesPayables';

const TODAY = new Date(2026, 7, 17); // 17 August 2026, local

const rcv = (over) => ({
  id: 1,
  status: 'pending',
  amount: '20',
  currency: 'USD',
  sale_detail: { customer_detail: { name: 'Ali' } },
  ...over,
});

const dated = (isoDate, over) => rcv({ due_date: `${isoDate}T00:00:00Z`, ...over });

describe('reading the due date off a receivable', () => {
  test('prefers the receivable\'s own field', () => {
    const row = dated('2026-09-01', {
      sale_detail: { customer_detail: { name: 'Ali' }, credit_due_date: '2026-12-31' },
    });
    expect(receivableDueDate(row)).toBe('2026-09-01');
  });

  test('falls back to the promise recorded on the sale', () => {
    const row = rcv({
      sale_detail: { customer_detail: { name: 'Ali' }, credit_due_date: '2026-12-31' },
    });
    expect(receivableDueDate(row)).toBe('2026-12-31');
  });

  test('a debt nobody dated has no date, not a wrong one', () => {
    expect(receivableDueDate(rcv())).toBeNull();
    expect(receivableDaysUntilDue(rcv(), TODAY)).toBeNull();
  });
});

describe('days until due', () => {
  test('counts calendar days, not fractions of one', () => {
    // Deliberately an afternoon "today": a debt due tomorrow must read 1, not 0.
    const afternoon = new Date(2026, 7, 17, 15, 30);
    expect(receivableDaysUntilDue(dated('2026-08-18'), afternoon)).toBe(1);
    expect(receivableDaysUntilDue(dated('2026-08-17'), afternoon)).toBe(0);
  });

  test('goes negative once the day has passed', () => {
    expect(receivableDaysUntilDue(dated('2026-08-10'), TODAY)).toBe(-7);
  });
});

describe('the colour scale', () => {
  test('settled is green whatever its date said', () => {
    expect(receivableRowBackground(dated('2026-08-01', { status: 'paid' }), TODAY)).toBe('#d4edda');
  });

  test('overdue is red', () => {
    expect(receivableRowBackground(dated('2026-08-16'), TODAY)).toBe('#f8d7da');
  });

  test('the last ten days are amber, and the boundary belongs to amber', () => {
    expect(receivableRowBackground(dated('2026-08-27'), TODAY)).toBe('#fff3cd');
    expect(receivableRowBackground(dated('2026-08-17'), TODAY)).toBe('#fff3cd');
  });

  test('comfortably ahead is left plain', () => {
    expect(receivableRowBackground(dated('2026-08-28'), TODAY)).toBeUndefined();
  });

  test('an undated debt is left plain — no date is not the same as no urgency', () => {
    expect(receivableRowBackground(rcv(), TODAY)).toBeUndefined();
  });
});

describe('grouping by customer', () => {
  const rows = [
    dated('2026-09-30', { id: 1, amount: '20', currency: 'USD' }),
    dated('2026-08-16', { id: 2, amount: '5', currency: 'USD' }),
    rcv({ id: 3, amount: '120000', currency: 'UZS' }),
    rcv({ id: 4, amount: '9', status: 'paid', sale_detail: { customer_detail: { name: 'Vali' } } }),
    rcv({ id: 5, amount: '7', sale_detail: {} }),
  ];

  test('each customer gets one heading, and rows with no customer share one', () => {
    const groups = groupReceivablesByCustomer(rows);
    expect(groups.map((g) => g.name)).toEqual(['Ali', 'Vali', '—']);
  });

  test('currencies are totalled apart — two debts in different money are not one number', () => {
    const [ali] = groupReceivablesByCustomer(rows);
    expect(ali.openTotals).toEqual({ USD: 25, UZS: 120000 });
    expect(ali.openCount).toBe(3);
  });

  test('a settled debt is listed but does not count towards what is owed', () => {
    const vali = groupReceivablesByCustomer(rows).find((g) => g.name === 'Vali');
    expect(vali.rows).toHaveLength(1);
    expect(vali.openCount).toBe(0);
    expect(vali.openTotals).toEqual({});
  });

  test('a group takes the urgency of its most pressing open debt', () => {
    // Ali has one debt six weeks out and one already overdue. The heading must read overdue —
    // otherwise a customer with something late looks fine as long as they also owe something
    // that is not.
    const [ali] = groupReceivablesByCustomer(rows);
    const days = receivableDaysUntilDue(dated('2026-08-16'));
    expect(ali.soonestDays).toBe(days);
  });

  test('a customer with nothing left owing reads as settled', () => {
    const vali = groupReceivablesByCustomer(rows).find((g) => g.name === 'Vali');
    expect(groupRowBackground(vali)).toBe('#d4edda');
  });
});
