/**
 * "Average units per weekday" — an average of *what*, exactly.
 *
 * The bars stay Mon–Sun; the toggle changes the slice being averaged over, and with it the
 * question the chart answers:
 *
 *   monthly — "in an average month, Mondays sold this much" — every Monday in a month added
 *             together, then averaged across months;
 *   weekly  — "on a typical Monday, this much" — one Monday per week, averaged across weeks.
 *
 * A month holds four or five Mondays, so the monthly number is roughly four times the weekly one.
 * That is the whole point of offering both: the monthly view says which weekday carries a month,
 * the weekly view says what to expect when you open the shop tomorrow.
 *
 * The trap this pins down is the denominator. Averaging is not summing, so switching granularity
 * must change the figure — a toggle that quietly returns the same number either way would be
 * indistinguishable from one that does nothing at all.
 */
import { buildNetWeekdayAverages, buildWeekdayAveragesFixed } from './dashboardAnalytics';

/** Four Mondays, one per week, all inside August 2026. */
const MONDAYS = ['2026-W32', '2026-W33', '2026-W34', '2026-W35'];

const monday = (week, units, salesman = 'alice') => ({
  month_key: '2026-08',
  week_key: week,
  weekday: 0,
  weekday_label: 'Mon',
  salesman_name: salesman,
  units,
});

const mondayRow = (rows, granularity) =>
  buildWeekdayAveragesFixed(rows, 'salesman_name', granularity).data
    .find((r) => r.weekday_label === 'Mon');

describe('the two views answer different questions', () => {
  // One sale of 2 units on each of August's four Mondays.
  const facts = MONDAYS.map((w) => monday(w, 2));

  it('monthly totals the month’s Mondays', () => {
    // Eight units across four Mondays, and only one month in the data.
    expect(mondayRow(facts, 'monthly').alice).toBe(8);
  });

  it('weekly averages one Monday at a time', () => {
    // Eight units across four separate weeks.
    expect(mondayRow(facts, 'weekly').alice).toBe(2);
  });

  it('the two genuinely differ, which is the point of the toggle', () => {
    expect(mondayRow(facts, 'monthly').alice).not.toBe(mondayRow(facts, 'weekly').alice);
  });

  it('defaults to monthly, so the chart opens as it always did', () => {
    expect(buildWeekdayAveragesFixed(facts, 'salesman_name').data)
      .toEqual(buildWeekdayAveragesFixed(facts, 'salesman_name', 'monthly').data);
  });
});

describe('averaging across more than one period', () => {
  it('divides monthly figures by the number of months', () => {
    const facts = [
      monday('2026-W32', 10),
      { ...monday('2026-W40', 20), month_key: '2026-09' },
    ];
    // Two months, one Monday's worth of sales in each: (10 + 20) / 2.
    expect(mondayRow(facts, 'monthly').alice).toBe(15);
  });

  it('divides weekly figures by the number of weeks', () => {
    const facts = [monday('2026-W32', 10), monday('2026-W33', 20)];
    expect(mondayRow(facts, 'weekly').alice).toBe(15);
  });

  it('counts only the periods that had sales', () => {
    // Pre-existing behaviour, kept deliberately: a week nobody worked is not a zero to average
    // in, it is a week that is not in the data at all.
    expect(mondayRow([monday('2026-W32', 10)], 'weekly').alice).toBe(10);
  });
});

describe('several salesmen', () => {
  const facts = [
    monday('2026-W32', 4, 'alice'),
    monday('2026-W33', 2, 'alice'),
    monday('2026-W32', 6, 'bob'),
  ];

  it('averages each over the same weeks', () => {
    const row = mondayRow(facts, 'weekly');
    expect(row.alice).toBe(3);  // (4 + 2) / 2 weeks
    expect(row.bob).toBe(3);    // 6 / 2 weeks — bob sold nothing in W33, which still counts
  });

  it('keeps everyone in the series list', () => {
    expect(buildWeekdayAveragesFixed(facts, 'salesman_name', 'weekly').keys)
      .toEqual(['alice', 'bob']);
  });
});

describe('returns come off in both views', () => {
  const sales = [monday('2026-W32', 6), monday('2026-W33', 6)];
  const returns = [monday('2026-W32', 2)];

  it('subtracts them weekly', () => {
    const row = buildNetWeekdayAverages(sales, returns, 'salesman_name', 'weekly').data
      .find((r) => r.weekday_label === 'Mon');
    // 6 sold on an average Monday, less 2 returned. See the note below on why the return
    // averages 2 rather than 1 — each side is averaged over its own periods.
    expect(row.alice).toBe(4);
  });

  it('averages each side over its own periods, not over a shared calendar', () => {
    /**
     * Pre-existing behaviour, made visible here rather than changed.
     *
     * Sales and returns are averaged separately and each divides by the periods *it* appears in.
     * Sales fall in two weeks, so they divide by two; the single return falls in one, so it
     * divides by one — and is effectively treated as happening every week. The subtraction is
     * therefore heavier than the sales side warrants.
     *
     * It has always worked this way, monthly included, and correcting it would move numbers the
     * shop has been reading for months. Weekly makes it more visible, because more periods mean
     * a wider gap between the two denominators.
     */
    const row = buildNetWeekdayAverages(sales, returns, 'salesman_name', 'weekly').data
      .find((r) => r.weekday_label === 'Mon');
    const soldOnly = buildWeekdayAveragesFixed(sales, 'salesman_name', 'weekly').data
      .find((r) => r.weekday_label === 'Mon');
    expect(soldOnly.alice).toBe(6);
    expect(soldOnly.alice - row.alice).toBe(2); // the whole return, not its share of two weeks
  });

  it('subtracts them monthly', () => {
    const row = buildNetWeekdayAverages(sales, returns, 'salesman_name', 'monthly').data
      .find((r) => r.weekday_label === 'Mon');
    expect(row.alice).toBe(10); // 12 sold − 2 returned, one month
  });

  it('never goes below zero', () => {
    const row = buildNetWeekdayAverages(
      [monday('2026-W32', 1)], [monday('2026-W32', 9)], 'salesman_name', 'weekly',
    ).data.find((r) => r.weekday_label === 'Mon');
    expect(row.alice).toBe(0);
  });
});

describe('facts with no week on them', () => {
  it('falls back to the month rather than lumping the year into one slice', () => {
    // A payload cached before return facts carried `week_key`. Bucketing on `undefined` would
    // collapse every fact into a single slice and divide by one.
    const noWeek = [
      { month_key: '2026-08', weekday: 0, weekday_label: 'Mon', salesman_name: 'alice', units: 10 },
      { month_key: '2026-09', weekday: 0, weekday_label: 'Mon', salesman_name: 'alice', units: 20 },
    ];
    expect(mondayRow(noWeek, 'weekly').alice).toBe(15);
  });
});
