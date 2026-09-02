/**
 * Bepul against the three things it contradicts.
 *
 * Chegirma, Konversiya farqi and Nasiya all answer the same question — where did the missing
 * money go? — and a gift makes that question meaningless: nothing was paid and nothing is owed.
 *
 * The bug worth pinning is not the hiding, it is what is left behind. A flag set before Bepul was
 * ticked stays in the form after its box disappears, and is submitted with the sale: a gift
 * recorded as carrying a discount, or an exchange-rate difference, that nobody can see on screen
 * to remove. Hiding a control is not clearing it.
 */
import { applyGiveawayToggle, shortfallOptionsVisible } from './saleCompletePayHelpers';

const form = (over = {}) => ({
  uzs: '', usd: '',
  balance_shortfall_type: '',
  balance_shortfall_amount: '',
  apply_currency_conversion_difference: false,
  apply_credit: false,
  credit_amount: '',
  credit_due_date: '',
  apply_giveaway: false,
  ...over,
});

describe('what Bepul hides', () => {
  it('hides Chegirma and Konversiya farqi once it is ticked', () => {
    expect(shortfallOptionsVisible({ needs: true }, form({ apply_giveaway: true }))).toBe(false);
  });

  it('shows them again the moment it is unticked', () => {
    expect(shortfallOptionsVisible({ needs: true }, form({ apply_giveaway: false }))).toBe(true);
  });

  it('still hides them when there is no shortfall to explain', () => {
    // The pre-existing rule, unchanged: the block belongs to a payment that fell short.
    expect(shortfallOptionsVisible({ needs: false }, form())).toBe(false);
  });

  it.each([[null], [undefined], [{}]])('treats %j meta as nothing to show', (meta) => {
    expect(shortfallOptionsVisible(meta, form())).toBe(false);
  });
});

describe('what Bepul clears', () => {
  /** The half that reaches the server. Each of these was a value the operator could no longer see. */
  const dirty = form({
    balance_shortfall_type: 'discount',
    balance_shortfall_amount: '50000',
    apply_currency_conversion_difference: true,
    apply_credit: true,
    credit_amount: '20',
    credit_due_date: '2026-10-01',
  });

  it('clears a discount that was typed before Bepul was ticked', () => {
    const next = applyGiveawayToggle(dirty, true);
    expect(next.balance_shortfall_type).toBe('');
    expect(next.balance_shortfall_amount).toBe('');
  });

  it('clears the conversion difference — the one that used to survive', () => {
    expect(applyGiveawayToggle(dirty, true).apply_currency_conversion_difference).toBe(false);
  });

  it('clears the credit, since a gift is not a debt', () => {
    const next = applyGiveawayToggle(dirty, true);
    expect(next.apply_credit).toBe(false);
    expect(next.credit_amount).toBe('');
    expect(next.credit_due_date).toBe('');
  });

  it('leaves nothing set that its own box would not show', () => {
    const next = applyGiveawayToggle(dirty, true);
    expect(shortfallOptionsVisible({ needs: true }, next)).toBe(false);
    expect(next.balance_shortfall_type || next.apply_currency_conversion_difference).toBeFalsy();
  });

  it('sets the flag itself', () => {
    expect(applyGiveawayToggle(form(), true).apply_giveaway).toBe(true);
  });
});

describe('unticking it', () => {
  it('turns the flag off', () => {
    expect(applyGiveawayToggle(form({ apply_giveaway: true }), false).apply_giveaway).toBe(false);
  });

  it('restores nothing, on purpose', () => {
    // Back to an ordinary unpaid sale: the operator says again what they mean. Reinstating a
    // discount they had abandoned would be the same bug pointing the other way.
    const next = applyGiveawayToggle(form({ apply_giveaway: true }), false);
    expect(next.balance_shortfall_type).toBe('');
    expect(next.apply_currency_conversion_difference).toBe(false);
    expect(next.apply_credit).toBe(false);
  });

  it('does not mutate the form it was given', () => {
    const original = form({ balance_shortfall_type: 'discount' });
    applyGiveawayToggle(original, true);
    expect(original.balance_shortfall_type).toBe('discount');
  });

  it('keeps the money already typed', () => {
    // Amounts are the operator's own input and are not this toggle's business to erase.
    const next = applyGiveawayToggle(form({ uzs: '100000', usd: '5' }), true);
    expect(next.uzs).toBe('100000');
    expect(next.usd).toBe('5');
  });
});
