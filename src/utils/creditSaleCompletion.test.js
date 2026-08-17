/**
 * Sharing out an unpaid remainder: some forgiven, some owed, some rate arithmetic.
 *
 * Discount, Nasiya and Konversiya farqi are three independent explanations for money the
 * customer did not hand over, and one gap can hold all three at once. They used to be
 * alternatives only because Discount and Nasiya shared a single column — never for an
 * accounting reason. The rule is:
 *
 *     discount (named) + credit (named) + fx (whatever is left) === due − paid
 *
 * These tests pin the arithmetic that decides whether the form lets a sale through and what it
 * sends. The server owns the final figures; what matters here is that the form agrees with it
 * about *whether* the payment is fully explained, so the user is never told a payment is fine
 * and then handed a rejection.
 */
import {
  buildCompleteSaleRequest,
  buildGroupCompleteRequests,
  computePaymentDifferenceMeta,
  emptyPaymentFormState,
} from './saleCompletePayHelpers';

const RATE = 12000;

const dollarSale = {
  id: 501,
  quantity: 1,
  selling_price: 20,
  total_amount: 20,
  sale_currency: 'USD',
  sale_type: 'bought_from_shop',
};

const soumSale = {
  id: 502,
  quantity: 1,
  selling_price: 240000,
  total_amount: 240000,
  sale_currency: 'UZS',
  sale_type: 'bought_from_shop',
};

const form = (over) => ({ ...emptyPaymentFormState(), ...over });
const onCredit = (over) => form({ apply_credit: true, credit_due_date: '2026-09-30', ...over });
const meta = (sale, f) => computePaymentDifferenceMeta(sale, f, RATE);

describe('credit on its own', () => {
  test('the whole price goes on credit when nothing is handed over', () => {
    const m = meta(dollarSale, onCredit());

    expect(m.creditExplained).toBe(true);
    expect(m.creditAmount).toBeCloseTo(20, 6);
    // The point of the whole branch: a zero payment is a complete answer, not an error.
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('a part payment credits only the remainder', () => {
    const m = meta(dollarSale, onCredit({ usd: '12' }));

    expect(m.creditAmount).toBeCloseTo(8, 6);
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('a missing due date is caught before the request is built', () => {
    expect(meta(dollarSale, onCredit({ credit_due_date: '' })).creditDueDateMissing).toBe(true);
  });

  test('ticked on a fully paid sale, there is no debt to open', () => {
    const m = meta(dollarSale, onCredit({ usd: '20' }));

    expect(m.creditWithNothingOwing).toBe(true);
    expect(m.differenceNeedsClassification).toBe(true);
  });

  test('a soum sale credits in soum, with no dollar arithmetic anywhere near it', () => {
    const m = meta(soumSale, onCredit({ uzs: '100000' }));

    expect(m.sc).toBe('UZS');
    expect(m.creditAmount).toBeCloseTo(140000, 3);
  });
});

describe('a gap shared between discount and credit', () => {
  /** The owner's case: $20 due, $12 paid, $2 forgiven, $6 owed. */
  const split = (over) =>
    onCredit({
      usd: '12',
      balance_shortfall_type: 'discount',
      balance_shortfall_amount: '2',
      credit_amount: '6',
      ...over,
    });

  test('both are honoured and the payment is fully explained', () => {
    const m = meta(dollarSale, split());

    expect(m.discountAmount).toBeCloseTo(2, 6);
    expect(m.creditAmount).toBeCloseTo(6, 6);
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('shares that add up to more than the gap are rejected', () => {
    // $5 forgiven and $6 credited against an $8 gap invents $3 nobody ever owed.
    const m = meta(dollarSale, split({ balance_shortfall_amount: '5' }));

    expect(m.sharesExceedGap).toBe(true);
    expect(m.differenceNeedsClassification).toBe(true);
  });

  test('what the two do not cover still has to be explained', () => {
    const m = meta(dollarSale, split({ credit_amount: '3' }));

    expect(m.sharesExceedGap).toBe(false);
    expect(m.differenceNeedsClassification).toBe(true);
  });

  test('the conversion difference absorbs what they leave', () => {
    const m = meta(
      dollarSale,
      split({ credit_amount: '3', apply_currency_conversion_difference: true }),
    );

    expect(m.differenceNeedsClassification).toBe(false);
    expect(m.conversionDifference).toBeCloseTo(-3, 6);
  });

  test('an unnamed credit takes whatever the discount leaves', () => {
    const m = meta(dollarSale, split({ credit_amount: '' }));

    // $8 gap, $2 forgiven → $6 on the book, without anyone having to do the subtraction.
    expect(m.creditAmount).toBeCloseTo(6, 6);
    expect(m.differenceNeedsClassification).toBe(false);
  });
});

describe('nothing here disturbs a payment with no credit on it', () => {
  test('a plain overpayment is still an unexplained surplus', () => {
    const m = meta(dollarSale, form({ usd: '25' }));

    expect(m.sharesExceedGap).toBe(false);
    expect(m.differenceNeedsClassification).toBe(true);
  });

  test('a discount-only shortfall behaves exactly as before', () => {
    const m = meta(
      dollarSale,
      form({ usd: '17', balance_shortfall_type: 'discount', balance_shortfall_amount: '3' }),
    );

    expect(m.differenceNeedsClassification).toBe(false);
    expect(m.creditAmount).toBe(0);
  });
});

describe('what is sent to the server', () => {
  test('the flag, the date and the named share travel together', () => {
    const f = onCredit({ usd: '12', credit_amount: '6' });
    const data = buildCompleteSaleRequest(f, meta(dollarSale, f), null);

    expect(data.apply_credit).toBe(true);
    expect(data.credit_due_date).toBe('2026-09-30');
    expect(data.credit_amount).toBe(6);
  });

  test('an unnamed share is left off, so the server decides it', () => {
    const f = onCredit({ usd: '12' });
    const data = buildCompleteSaleRequest(f, meta(dollarSale, f), null);

    expect(data.apply_credit).toBe(true);
    // The balance sheet subtracts the server's figure again on the other side, so a second
    // opinion computed here could only ever disagree with it.
    expect(data.credit_amount).toBeUndefined();
  });

  test('discount and credit are sent side by side', () => {
    const f = onCredit({
      usd: '12',
      balance_shortfall_type: 'discount',
      balance_shortfall_amount: '2',
      credit_amount: '6',
    });
    const data = buildCompleteSaleRequest(f, meta(dollarSale, f), null);

    expect(data.balance_shortfall_type).toBe('discount');
    expect(data.balance_shortfall_amount).toBe(2);
    expect(data.apply_credit).toBe(true);
    expect(data.credit_amount).toBe(6);
  });

  test('an ordinary sale carries no credit fields at all', () => {
    const f = form({ usd: '20' });
    const data = buildCompleteSaleRequest(f, meta(dollarSale, f), null);

    expect(data.apply_credit).toBeUndefined();
    expect(data.credit_due_date).toBeUndefined();
  });
});

describe('a group checkout taken on credit', () => {
  const lineA = { ...dollarSale, id: 601, selling_price: 30, total_amount: 30, quantity: 1 };
  const lineB = { ...dollarSale, id: 602, selling_price: 10, total_amount: 10, quantity: 1 };
  const lines = [lineA, lineB];

  test('every line opens its own debt, all on the same date', () => {
    const f = onCredit();
    const reqs = buildGroupCompleteRequests(lines, f, meta(lineA, f), null);

    expect(reqs.map((r) => r.id)).toEqual([601, 602]);
    reqs.forEach((r) => {
      expect(r.data.apply_credit).toBe(true);
      expect(r.data.credit_due_date).toBe('2026-09-30');
      // Never the group's figure: sending it to each line would credit it once per line.
      expect(r.data.credit_amount).toBeUndefined();
    });
  });

  test('a part payment is split by due, and the shares add back to what was handed over', () => {
    // $40 of goods, $10 paid. Weighted 30/40 and 10/40 → $7.50 and $2.50.
    const f = onCredit({ usd: '10' });
    const reqs = buildGroupCompleteRequests(lines, f, meta(lineA, f), null);

    expect(reqs[0].data.usd).toBeCloseTo(7.5, 6);
    expect(reqs[1].data.usd).toBeCloseTo(2.5, 6);
    expect(reqs[0].data.usd + reqs[1].data.usd).toBeCloseTo(10, 6);
  });

  test('a group discount still reaches every line and does not become credit', () => {
    const f = form({
      balance_shortfall_type: 'discount', balance_shortfall_amount: '4', usd: '36',
    });
    const reqs = buildGroupCompleteRequests(lines, f, meta(lineA, f), null);

    reqs.forEach((r) => {
      expect(r.data.balance_shortfall_type).toBe('discount');
      expect(r.data.apply_credit).toBeUndefined();
    });
  });

  test('an ordinary group completion carries no credit fields at all', () => {
    const f = form({ usd: '40' });
    const reqs = buildGroupCompleteRequests(lines, f, meta(lineA, f), null);

    reqs.forEach((r) => {
      expect(r.data.balance_shortfall_type).toBeUndefined();
      expect(r.data.apply_credit).toBeUndefined();
      expect(r.data.credit_due_date).toBeUndefined();
    });
  });
});
