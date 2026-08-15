/**
 * The group delivery settlement that could not be completed: a dollar-priced trip paid in soum,
 * with an advance behind it and the courier's own change at the door.
 *
 * Sales #335/#336 on 15.08.2026. $100 + 3x$20 = $160 of goods against one customer, 400,000 UZS
 * taken as an advance on the first line. The courier collected 1,000,000 UZS on one item and
 * $60 on the other, and handed back $15 of his own money. The shop's remittance form rejected
 * the whole thing with "payment cannot exceed the remaining amount due ($126.49 after advance)"
 * — the $17.28 it objected to was the courier's $15 plus the $2.28 rate gap he had already
 * flagged, and both have a home.
 */
import {
  computeAdvanceRemainingDue,
  computePaymentDifferenceMeta,
  saleHasOrderAdvance,
  validateAdvanceCompletionPayment,
} from './saleCompletePayHelpers';

const RATE = 11937.89;

const line335 = {
  id: 335,
  quantity: 1,
  selling_price: 100,
  total_amount: 100,
  sale_currency: 'USD',
  sale_type: 'delivery',
  order: 300,
  advance_payment_received: 400000,
  advance_payment_currency: 'UZS',
  delivery_customer_collected_uzs: 1000000,
  delivery_customer_collected_usd: 0,
  delivery_change_given_usd: 15,
  delivery_change_given_uzs: 0,
};

const line336 = {
  id: 336,
  quantity: 3,
  selling_price: 20,
  total_amount: 60,
  sale_currency: 'USD',
  sale_type: 'delivery',
  order: 301,
  advance_payment_received: 0,
  delivery_customer_collected_uzs: 0,
  delivery_customer_collected_usd: 60,
};

const groupSale = {
  ...line335,
  isSaleGroup: true,
  groupSales: [line335, line336],
  quantity: 4,
  selling_price: 40,
  total_amount: 160,
  discount_price: null,
};

/** What the delivery form now feeds the arithmetic: the gross, with the courier's change named. */
const remittanceForm = {
  uzs: '1000000',
  usd: '60',
  apply_change: true,
  change_uzs: '',
  change_usd: '15',
  balance_shortfall_type: '',
  balance_shortfall_amount: '',
  apply_currency_conversion_difference: true,
  apply_additional_profit: false,
  currency_conversion_difference_amount: '',
};

describe('group delivery remittance with an advance and courier change', () => {
  it('sees the advance even though it sits on a line other than the first', () => {
    const firstHasNoAdvance = {
      ...groupSale,
      advance_payment_received: 0,
      groupSales: [{ ...line336 }, { ...line335 }],
    };
    expect(saleHasOrderAdvance(firstHasNoAdvance)).toBe(true);
  });

  it('sums the advance across the group rather than taking the first line as the whole', () => {
    const due = computeAdvanceRemainingDue(groupSale, null, RATE);
    // 160 - (400,000 / 11,937.89) = 160 - 33.51
    expect(due).toBeCloseTo(126.49, 2);
  });

  it('nets the courier own change out of the surplus, leaving only the rate gap', () => {
    const meta = computePaymentDifferenceMeta(groupSale, remittanceForm, RATE);
    // gross 83.77 + 60 = 143.77; less the courier's 15 = 128.77 kept; against 126.49 due.
    expect(meta.remainingAfterDiscount).toBeCloseTo(2.28, 2);
    expect(meta.conversionDifference).toBeCloseTo(2.28, 2);
    expect(meta.differenceNeedsClassification).toBe(false);
  });

  it('lets the remittance through once the surplus is classified', () => {
    const ok = validateAdvanceCompletionPayment(
      groupSale, remittanceForm.uzs, remittanceForm.usd, null, RATE, 15, true,
    );
    expect(ok.ok).toBe(true);
  });

  it('still blocks a surplus nobody has accounted for', () => {
    const blocked = validateAdvanceCompletionPayment(
      groupSale, remittanceForm.uzs, remittanceForm.usd, null, RATE, 15, false,
    );
    expect(blocked.ok).toBe(false);
  });

  it('still blocks an overpayment with no advance classification on a plain line', () => {
    const blocked = validateAdvanceCompletionPayment(line335, '', '200', null, RATE, 0, false);
    expect(blocked.ok).toBe(false);
  });
});
