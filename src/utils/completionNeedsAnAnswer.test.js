/**
 * Completing a sale with nothing typed and nothing chosen.
 *
 * The Complete & Pay form prefills the payment with the full price, so an empty box means the
 * user cleared it. That is a legitimate thing to do — Nasiya and Bepul are both settled with no
 * money at all — but only once one of the options says where the money went. With none of them
 * ticked the form used to submit anyway, and the sale was recorded as paid in full against a
 * till that never saw a som. That is exactly how sale #350 lost $279.
 *
 * The cause was a blank payment reading as "nothing typed yet" rather than as a missing answer.
 * `computePaymentDifferenceMeta` short-circuits when it cannot read a payment, and the
 * short-circuit reported "nothing to classify" — true of a rate still loading, false of a form
 * the user has finished with.
 *
 * These tests keep the two apart: silence while the form cannot know, a refusal once it can.
 */
import {
  computePaymentDifferenceMeta,
  emptyPaymentFormState,
} from './saleCompletePayHelpers';

const RATE = 12000;

const dollarSale = {
  id: 601,
  quantity: 1,
  selling_price: 279,
  total_amount: 279,
  sale_currency: 'USD',
  sale_type: 'bought_from_shop',
};

const soumSale = {
  id: 602,
  quantity: 1,
  selling_price: 240000,
  total_amount: 240000,
  sale_currency: 'UZS',
  sale_type: 'bought_from_shop',
};

const form = (over) => ({ ...emptyPaymentFormState(), ...over });
const meta = (sale, f, rate = RATE) => computePaymentDifferenceMeta(sale, f, rate);

describe('nothing entered and nothing chosen', () => {
  test('a cleared payment with no option ticked is refused', () => {
    expect(meta(dollarSale, form()).differenceNeedsClassification).toBe(true);
  });

  test('the same in soum', () => {
    expect(meta(soumSale, form()).differenceNeedsClassification).toBe(true);
  });

  test('the payment is reported as unreadable, which is what the form checks', () => {
    // The form shows its own message for this rather than the generic "classify the difference"
    // one, and picks that case out by `paid == null` on a sale that is owed something.
    const m = meta(dollarSale, form());
    expect(m.paid).toBeNull();
    expect(m.due).toBeCloseTo(279, 6);
  });
});

describe('an answer was given', () => {
  test('Bepul explains the whole price', () => {
    const m = meta(dollarSale, form({ apply_giveaway: true }));

    expect(m.giveawayExplained).toBe(true);
    expect(m.differenceNeedsClassification).toBe(false);
    // Read as the zero it is, so the confirm popup can name the amount being written off.
    expect(m.paid).toBe(0);
    expect(m.gap).toBeCloseTo(279, 6);
  });

  test('Nasiya still explains the whole price', () => {
    const m = meta(
      dollarSale,
      form({ apply_credit: true, credit_due_date: '2026-09-30' }),
    );
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('a discount is an answer once some money was handed over', () => {
    const m = meta(
      dollarSale,
      form({ usd: '250', balance_shortfall_type: 'discount', balance_shortfall_amount: '29' }),
    );
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('but a discount for the *whole* price with no payment is not — Bepul is', () => {
    // Deliberate. The server bails out before it ever reads the classification when nothing at
    // all was paid, so a 100% discount sent this way is dropped and the sale is recorded as paid
    // in full — the #350 failure again, wearing a different hat. Bepul is the supported route
    // for giving the whole thing away, and it is the one the form pushes the user towards.
    const m = meta(
      dollarSale,
      form({ balance_shortfall_type: 'discount', balance_shortfall_amount: '279' }),
    );
    expect(m.differenceNeedsClassification).toBe(true);
  });

  test('and simply paying is an answer', () => {
    expect(meta(dollarSale, form({ usd: '279' })).differenceNeedsClassification).toBe(false);
  });
});

describe('silence where the form cannot yet know', () => {
  test('a rate still loading is not a missing answer', () => {
    // Split payment with no rate: the form cannot value what was typed, so it must say nothing
    // rather than accuse the user of leaving the sale unexplained.
    const m = meta(dollarSale, form({ uzs: '1000000', usd: '200' }), null);
    expect(m.mixed).toBe(true);
    expect(m.differenceNeedsClassification).toBe(false);
  });

  test('a sale that owes nothing is not blocked', () => {
    const free = { ...dollarSale, id: 603, selling_price: 0, total_amount: 0 };
    expect(meta(free, form()).differenceNeedsClassification).toBe(false);
  });
});
