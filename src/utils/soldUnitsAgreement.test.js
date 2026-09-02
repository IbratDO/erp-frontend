/**
 * The four places the shop's "how much did we sell" figure appears, and why they must agree.
 *
 * They did not. Each had grown its own definition:
 *
 *   - the Sotuv table totalled every row it displayed, cancelled sales included;
 *   - "Sotuvlar soni" added 1 per sale, so one sale of five pairs counted as one;
 *   - the category chart counted units net of returns, but from a sale list that excluded
 *     fully-returned sales — so a return was subtracted whose sale had never been added, and the
 *     units came off *other* products in the same month;
 *   - the marketing chart counted units net of returns from a different sale list again.
 *
 * The agreed definition is now one sentence: **units on finished sales, less what came back.**
 * These tests hold the frontend half of that to it.
 */
import { buildNetMonthlyStacked, buildSalesSeries } from './dashboardAnalytics';

const sale = (over = {}) => ({
  month: 3, month_key: '2026-03', week_key: '2026-W10', week_label: 'W10',
  category: 'Krossovka', units: 1, revenue_usd: 100, revenue_uzs: 0, ...over,
});
const ret = (over = {}) => ({
  month: 3, month_key: '2026-03', week_key: '2026-W10', week_label: 'W10',
  category: 'Krossovka', units: 1, ...over,
});

const march = (rows) => rows.find((r) => r.period === 'Mar');

describe('the sold-units line counts units, not sales', () => {
  it('counts one sale of five pairs as five', () => {
    // The bug in one line: this used to report 1.
    expect(march(buildSalesSeries([sale({ units: 5 })], [], 'monthly')).sales).toBe(5);
  });

  it('adds up across several sales', () => {
    const rows = buildSalesSeries([sale({ units: 5 }), sale({ units: 2 })], [], 'monthly');
    expect(march(rows).sales).toBe(7);
  });

  it('keeps every month of the year on the axis', () => {
    // Unchanged behaviour: the chart reads as a calendar, not as "the months that had sales".
    expect(buildSalesSeries([sale()], [], 'monthly')).toHaveLength(12);
  });
});

describe('returns come off', () => {
  it('subtracts a return from the month it came back in', () => {
    const rows = buildSalesSeries([sale({ units: 5 })], [ret({ units: 2 })], 'monthly');
    expect(march(rows).sales).toBe(3);
  });

  it('reports the gross and the returned figures too', () => {
    const row = march(buildSalesSeries([sale({ units: 5 })], [ret({ units: 2 })], 'monthly'));
    expect(row.sold).toBe(5);
    expect(row.returned).toBe(2);
  });

  it('never draws below zero', () => {
    // A return processed in a later month than its sale would otherwise read as negative sales.
    const rows = buildSalesSeries([sale({ units: 1 })], [ret({ units: 4 })], 'monthly');
    expect(march(rows).sales).toBe(0);
  });

  it('subtracts by week when the chart is weekly', () => {
    // Return facts carry `week_key` now; without it a weekly chart subtracted nothing at all.
    const rows = buildSalesSeries(
      [sale({ units: 5 })], [ret({ units: 2 })], 'weekly',
    );
    const w10 = rows.find((r) => r.period === 'W10');
    expect(w10.sales).toBe(3);
  });

  it('does not subtract a return that belongs to another week', () => {
    const rows = buildSalesSeries(
      [sale({ units: 5 })],
      [ret({ units: 2, week_key: '2026-W20', week_label: 'W20' })],
      'weekly',
    );
    expect(rows.find((r) => r.period === 'W10').sales).toBe(5);
  });

  it('works with no returns at all', () => {
    expect(march(buildSalesSeries([sale({ units: 3 })], null, 'monthly')).sales).toBe(3);
  });
});

describe('the two unit charts agree', () => {
  /**
   * The whole point. Same facts in, same total out — a line chart and a stacked bar chart that
   * disagree about the same month is what sent the owner looking in the first place.
   */
  const sales = [
    sale({ units: 5, category: 'Krossovka' }),
    sale({ units: 3, category: 'Futbolka' }),
  ];
  const returns = [ret({ units: 2, category: 'Krossovka' })];

  it('report the same total for the month', () => {
    const line = march(buildSalesSeries(sales, returns, 'monthly')).sales;

    const stacked = buildNetMonthlyStacked(sales, returns, 'category');
    const row = stacked.data.find((r) => r.month_key === '2026-03');
    const bars = stacked.keys.reduce((sum, k) => sum + (row[k] || 0), 0);

    expect(line).toBe(6); // 5 + 3 − 2
    expect(bars).toBe(line);
  });

  it('still agree when nothing was returned', () => {
    const line = march(buildSalesSeries(sales, [], 'monthly')).sales;
    const stacked = buildNetMonthlyStacked(sales, [], 'category');
    const row = stacked.data.find((r) => r.month_key === '2026-03');
    const bars = stacked.keys.reduce((sum, k) => sum + (row[k] || 0), 0);
    expect(line).toBe(8);
    expect(bars).toBe(line);
  });
});

describe('revenue is still carried', () => {
  it('sums the money as it always did', () => {
    const row = march(buildSalesSeries([sale({ revenue_usd: 100 }), sale({ revenue_usd: 50 })], [], 'monthly'));
    expect(row.revenue_usd).toBe(150);
  });
});
