/**
 * "How much is owed on this return?" — and the difference between nothing and unknown.
 *
 * The Bepul return could not be closed: the page refused it with "Ushbu qaytarish uchun qarz
 * summasi mavjud emas" — no debt figure available. A gift owes nothing *by definition*, so there
 * was nothing wrong with the data; the helper simply had one value, `null`, standing for two
 * different situations:
 *
 *   nothing is owed        a known figure, and that figure is zero
 *   cannot be worked out   a debt live in both currencies with no rate to size it
 *
 * The page refuses to settle a refund it cannot size, which is right for the second and wrong for
 * the first. These tests keep the two apart.
 */
import {
  computeReturnRefundDue,
  computeReturnRefundMeta,
} from './returnRefundHelpers';

/** A return row as the API serves it. */
function ret(over = {}) {
  return {
    quantity: 1,
    sold_price_uzs: '0',
    sold_price_usd: '0',
    sale_detail: { sale_currency: 'USD', quantity: 1, paid_legs: { uzs: 0, usd: 0 } },
    ...over,
  };
}

describe('nothing is owed', () => {
  test('a gift owes zero, which is a figure — not a missing one', () => {
    expect(computeReturnRefundDue(ret()).amount).toBe(0);
  });

  test('so the page can size the refund and will not refuse to settle it', () => {
    const meta = computeReturnRefundMeta(ret(), { uzs: '0', usd: '0' }, 12000);
    expect(meta.dueUnavailable).toBe(false);
  });

  test('zero owed and zero handed over is not a shortfall', () => {
    const meta = computeReturnRefundMeta(ret(), { uzs: '0', usd: '0' }, 12000);
    expect(meta.needs).toBe(false);
    expect(meta.short).toBe(0);
    expect(meta.exceedsDue).toBe(false);
  });

  test('paying anything against a debt of nothing is an overpayment', () => {
    // Worth keeping: it is the check that stops cash walking out against a gift.
    const meta = computeReturnRefundMeta(ret(), { uzs: '0', usd: '5' }, 12000);
    expect(meta.exceedsDue).toBe(true);
  });
});

describe('genuinely cannot be worked out', () => {
  test('a debt live in both currencies has no single-currency size without a rate', () => {
    const both = ret({ sold_price_uzs: '120000', sold_price_usd: '10' });
    expect(computeReturnRefundDue(both).amount).toBeNull();
    expect(computeReturnRefundMeta(both, { uzs: '0', usd: '0' }, null).dueUnavailable).toBe(true);
  });

  test('and is sized once a rate is known', () => {
    const both = ret({ sold_price_uzs: '120000', sold_price_usd: '10' });
    const meta = computeReturnRefundMeta(both, { uzs: '0', usd: '0' }, 12000);
    expect(meta.dueUnavailable).toBe(false);
    expect(meta.due).toBeCloseTo(20, 2);
  });
});

describe('ordinary refunds are unchanged', () => {
  test('a single-currency debt reports its own amount', () => {
    expect(computeReturnRefundDue(ret({ sold_price_usd: '20' })).amount).toBe(20);
    expect(computeReturnRefundDue(ret({ sold_price_uzs: '240000' })).currency).toBe('UZS');
  });

  test('a real debt settled with nothing is still a shortfall', () => {
    const meta = computeReturnRefundMeta(ret({ sold_price_usd: '20' }), { uzs: '', usd: '' }, 12000);
    expect(meta.needs).toBe(true);
    expect(meta.short).toBe(20);
  });

  test('what the sale actually took is used when the return carries no legs of its own', () => {
    const row = ret({
      sale_detail: { sale_currency: 'USD', quantity: 1, paid_legs: { uzs: 0, usd: 12 } },
    });
    expect(computeReturnRefundDue(row).amount).toBe(12);
  });
});
