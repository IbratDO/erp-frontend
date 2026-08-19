/**
 * The basket the courier had to divide by hand, and what happens once the code divides it.
 *
 * Group #10 on 13.08.2026 — Zikrulloh, three Uniqlo items delivered together. Listed at
 * $85.00 / $55.00 / $85.00 with a $49.40 advance behind each, so the amounts still owed at the
 * door were $35.60, $5.60 and $35.60. The customer handed over 900,000 UZS for all three.
 *
 * The courier's screen gave him one box per item and no total, so he split it the only way that
 * looks fair with three boxes in front of you: 300,000 each. Judged one at a time that reads as
 * two items short by $10.49 and one item **overpaid by $19.51** — and an unclassified surplus
 * moved that item's price from $55.00 to $74.51 on its own. The basket was $1.48 short. Every
 * line was wrong; the three errors happened to cancel.
 *
 * Weighting by what each line owes is the rule the counter till has always used. These tests
 * pin it to this basket: the money still adds up to 900,000, and no line can come out over.
 */
import { splitDeliveryCollectionByDue } from './saleCompletePayHelpers';

const RATE = 11948.58; // CBU, 13.08.2026

/** A group #10 line as the settlement form sees it. */
const line = (id, price) => ({
  id,
  quantity: 1,
  selling_price: price,
  total_amount: price,
  sale_currency: 'USD',
  sale_type: 'delivery',
  order: id + 100,
  advance_payment_received: 49.4,
  advance_payment_currency: 'USD',
});

const GROUP_10 = [line(327, 85), line(328, 55), line(329, 85)];
const HANDED_OVER = 900000;

const usd = (som) => som / RATE;

describe('splitDeliveryCollectionByDue', () => {
  it('gives each line a share of the money in proportion to what it owes', () => {
    const shares = splitDeliveryCollectionByDue(GROUP_10, { uzs: HANDED_OVER }, RATE);

    // Owed 35.60 / 5.60 / 35.60 out of 76.80 — so roughly 46% / 7% / 46% of the money.
    // The last line carries the remainder, which is why it is the one holding the odd som.
    expect(shares.map((s) => Number(s.uzs))).toEqual([417187, 65625, 417188]);
  });

  it('hands over exactly what the customer handed over, not a rounded version of it', () => {
    const shares = splitDeliveryCollectionByDue(GROUP_10, { uzs: HANDED_OVER }, RATE);
    const total = shares.reduce((sum, s) => sum + Number(s.uzs), 0);

    expect(total).toBe(HANDED_OVER);
  });

  it('leaves no line looking overpaid — which is what moved the $55.00 price to $74.51', () => {
    const shares = splitDeliveryCollectionByDue(GROUP_10, { uzs: HANDED_OVER }, RATE);

    const gaps = GROUP_10.map((l, i) => {
      const due = Number(l.total_amount) - Number(l.advance_payment_received);
      return due - usd(Number(shares[i].uzs));
    });

    // Every line short, none over, and none by more than the whole basket's shortfall.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(1);
    }
    // The one real shortfall, not three invented ones: 76.80 owed against 900,000 UZS.
    const basketShort = 76.8 - usd(HANDED_OVER);
    expect(gaps.reduce((a, b) => a + b, 0)).toBeCloseTo(basketShort, 6);
    expect(basketShort).toBeCloseTo(1.4772, 4);
  });

  it('is what the even split was not: 300,000 each leaves one line $19.51 over', () => {
    // The state of the books today, kept here so the fault this fixes stays legible.
    const evenGaps = GROUP_10.map((l) => {
      const due = Number(l.total_amount) - Number(l.advance_payment_received);
      return due - usd(300000);
    });

    expect(evenGaps[0]).toBeCloseTo(10.4924, 4);
    expect(evenGaps[1]).toBeCloseTo(-19.5076, 4);
    expect(evenGaps[2]).toBeCloseTo(10.4924, 4);
    // Cancelling in total is exactly why nobody noticed.
    expect(evenGaps.reduce((a, b) => a + b, 0)).toBeCloseTo(1.4772, 4);
  });

  it('splits dollars the same way, to the cent', () => {
    const shares = splitDeliveryCollectionByDue(GROUP_10, { usd: 75.32 }, RATE);

    expect(shares.map((s) => Number(s.usd))).toEqual([34.91, 5.49, 34.92]);
    expect(shares.reduce((sum, s) => sum + Number(s.usd), 0)).toBeCloseTo(75.32, 10);
  });

  it('refuses to guess while the rate is still loading', () => {
    const somAdvance = GROUP_10.map((l) => ({
      ...l,
      advance_payment_received: 590000,
      advance_payment_currency: 'UZS',
    }));

    // A soum advance against a dollar price cannot be read without a rate, so there is no
    // honest weighting to be had — better to leave the courier's boxes alone.
    expect(splitDeliveryCollectionByDue(somAdvance, { uzs: HANDED_OVER }, null)).toBeNull();
    expect(splitDeliveryCollectionByDue(somAdvance, { uzs: HANDED_OVER }, RATE)).not.toBeNull();
  });

  it('falls back to equal shares when the basket is already paid off', () => {
    const settled = GROUP_10.map((l) => ({ ...l, advance_payment_received: l.total_amount }));
    const shares = splitDeliveryCollectionByDue(settled, { uzs: 300 }, RATE);

    expect(shares.map((s) => Number(s.uzs))).toEqual([100, 100, 100]);
  });

  it('handles the ordinary single-line delivery by handing it everything', () => {
    const shares = splitDeliveryCollectionByDue([line(327, 85)], { uzs: HANDED_OVER }, RATE);

    expect(shares).toEqual([{ id: 327, uzs: String(HANDED_OVER), usd: '' }]);
  });

  it('has nothing to divide when every line was declined at the door', () => {
    expect(splitDeliveryCollectionByDue([], { uzs: HANDED_OVER }, RATE)).toEqual([]);
  });
});
