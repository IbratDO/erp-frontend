/**
 * Finishing a sale the customer already paid for in full.
 *
 * An on-demand order can be taken with an advance covering the whole selling price. When the
 * goods arrive there is nothing left to collect — and the till used to refuse to finish, because
 * "enter at least one amount" fired before anything had looked at whether an amount was still
 * owed. Sale #355 was stuck exactly there: the server accepted the completion (verified with a
 * rolled-back request against the real endpoint), the form would not send it.
 *
 * The rule is right everywhere money is still expected, which is why the exceptions keep being
 * discovered one at a time — credit was the first, this is the second. The two tests that matter
 * most here are the pair: nothing owed lets an empty payment through, and something owed still
 * does not.
 */
import { runSalePaymentSubmitFlow } from './salePaymentFlowHelpers';

const prepaidSale = (over = {}) => ({
  id: 355,
  sale_type: 'from_order',
  sale_currency: 'USD',
  quantity: 1,
  total_amount: '100.00',
  selling_price: '100.00',
  order: 444,
  advance_payment_received: '100.00',
  advance_payment_currency: 'USD',
  ...over,
});

const emptyPayment = { uzs: '', usd: '' };

async function run(sale, form = emptyPayment, extra = {}) {
  const errors = [];
  const result = await runSalePaymentSubmitFlow({
    sale,
    paymentFormData: form,
    exchangeRate: { rate: 12000 },
    exchangeRateError: null,
    showNotification: (msg) => errors.push(msg),
    ...extra,
  });
  return { result, errors };
}

describe('a sale already paid in full', () => {
  it('completes with nothing entered at the counter', async () => {
    const { result } = await run(prepaidSale());
    expect(result.ok).toBe(true);
  });

  it('does not ask for a payment that cannot exist', async () => {
    const { errors } = await run(prepaidSale());
    expect(errors).toEqual([]);
  });

  it('sends no money legs, because none changed hands', async () => {
    const { result } = await run(prepaidSale());
    expect(Number(result.requestData.uzs) || 0).toBe(0);
    expect(Number(result.requestData.usd) || 0).toBe(0);
  });

  it('asks for no discount or shortfall classification', async () => {
    // If the advance were not netted off, the form would read $100 as unpaid and demand it be
    // called a discount — writing off money the customer had already handed over.
    const { result } = await run(prepaidSale());
    expect(result.requestData.balance_shortfall_type).toBeFalsy();
    expect(result.requestData.apply_credit).toBeFalsy();
  });

  it('works when the advance was paid in the other currency', async () => {
    const soumAdvance = prepaidSale({
      advance_payment_received: '1200000',
      advance_payment_currency: 'UZS',
    });
    const { result } = await run(soumAdvance);
    expect(result.ok).toBe(true);
  });
});

describe('the rule this must not weaken', () => {
  it('still demands a payment when money is genuinely owed', async () => {
    const partly = prepaidSale({ advance_payment_received: '40.00' });
    const { result, errors } = await run(partly);
    expect(result.ok).toBe(false);
    expect(errors.length).toBe(1);
  });

  it('still demands a payment when there was no advance at all', async () => {
    const plain = prepaidSale({
      advance_payment_received: '0',
      sale_type: 'bought_from_shop',
      order: null,
    });
    const { result } = await run(plain);
    expect(result.ok).toBe(false);
  });

  it('does not treat an unknown rate as nothing owed', async () => {
    // A soum advance against a dollar price cannot be netted without a rate. Unknown must stay
    // unknown — reading it as zero would wave through a sale that is genuinely part paid.
    const soumAdvance = prepaidSale({
      advance_payment_received: '1200000',
      advance_payment_currency: 'UZS',
    });
    const { result } = await run(soumAdvance, emptyPayment, { exchangeRate: null });
    expect(result.ok).toBe(false);
  });
});
