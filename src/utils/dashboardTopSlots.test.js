/**
 * "Units sold by category", reshaped so each month shows only its own biggest sellers.
 *
 * The chart used to draw one series per category that had ever sold, which meant hovering a
 * month listed every category in the business — most of them zero — and the ones that actually
 * sold were lost in the list.
 *
 * The awkward part, and what most of these cases are about: the top 5 is worked out per month,
 * so a category moves between slots as the months change. Position therefore cannot identify a
 * category and colour has to, which is why `categoryColors` is fixed for the whole chart.
 */
import {
  OTHERS_SLOT,
  buildTopSlots,
  slotKey,
} from './dashboardAnalytics';

/** `buildNetMonthlyStacked` output: a row per month, a field per category. */
function series(keys, ...months) {
  return {
    keys,
    data: months.map(([monthLabel, values]) => ({
      month_key: `2026-${monthLabel}`, monthLabel, ...values,
    })),
  };
}

describe('dropping what did not sell', () => {
  test('a category that sold nothing this month is not in the bar at all', () => {
    const out = buildTopSlots(
      series(['Ko\'ylak', 'Shim', 'Sumka'], ['Jan', { 'Ko\'ylak': 5, Shim: 0, Sumka: 3 }]),
    );
    const [jan] = out.data;
    expect(jan[slotKey(0)]).toBe(5);
    expect(jan[`${slotKey(0)}Name`]).toBe('Ko\'ylak');
    expect(jan[slotKey(1)]).toBe(3);
    expect(jan[`${slotKey(1)}Name`]).toBe('Sumka');
    // Shim sold nothing: no third slot, so nothing to draw and nothing to list on hover.
    expect(jan[slotKey(2)]).toBeUndefined();
  });

  test('a category that never sold at all gets no colour and no legend entry', () => {
    const out = buildTopSlots(
      series(['Ko\'ylak', 'Dormant'], ['Jan', { 'Ko\'ylak': 5, Dormant: 0 }]),
    );
    expect(out.categoryColors.Dormant).toBeUndefined();
    expect(out.namedCategories).toEqual(['Ko\'ylak']);
  });

  test('a month with no sales at all is an empty bar, not a crash', () => {
    const out = buildTopSlots(series(['Ko\'ylak'], ['Jan', { 'Ko\'ylak': 0 }]));
    expect(out.data).toHaveLength(1);
    expect(out.data[0][slotKey(0)]).toBeUndefined();
    expect(out.slotCount).toBe(0);
  });
});

describe('biggest at the bottom', () => {
  test('slot 0 is the month\'s biggest seller, and they descend from there', () => {
    const out = buildTopSlots(
      series(['A', 'B', 'C'], ['Jan', { A: 10, B: 30, C: 20 }]),
    );
    const [jan] = out.data;
    // slot0 renders first, which Recharts draws at the base of the stack.
    expect([jan[`${slotKey(0)}Name`], jan[`${slotKey(1)}Name`], jan[`${slotKey(2)}Name`]])
      .toEqual(['B', 'C', 'A']);
    expect([jan[slotKey(0)], jan[slotKey(1)], jan[slotKey(2)]]).toEqual([30, 20, 10]);
  });

  test('a tie is broken by name, so the order does not wander between renders', () => {
    const out = buildTopSlots(series(['Beta', 'Alpha'], ['Jan', { Beta: 7, Alpha: 7 }]));
    expect(out.data[0][`${slotKey(0)}Name`]).toBe('Alpha');
  });
});

describe('the leftovers', () => {
  test('everything past the fifth is summed into one group', () => {
    const out = buildTopSlots(
      series(
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        ['Jan', { A: 60, B: 50, C: 40, D: 30, E: 20, F: 7, G: 3 }],
      ),
    );
    const [jan] = out.data;
    expect(jan[slotKey(4)]).toBe(20);
    expect(jan[OTHERS_SLOT]).toBe(10);
    expect(jan.othersNames).toEqual(['F', 'G']);
    expect(out.hasOthers).toBe(true);
  });

  test('exactly five leaves no group at all', () => {
    const out = buildTopSlots(
      series(['A', 'B', 'C', 'D', 'E'], ['Jan', { A: 5, B: 4, C: 3, D: 2, E: 1 }]),
    );
    expect(out.data[0][OTHERS_SLOT]).toBeUndefined();
    expect(out.hasOthers).toBe(false);
  });

  test('the limit is adjustable', () => {
    const out = buildTopSlots(
      series(['A', 'B', 'C'], ['Jan', { A: 5, B: 4, C: 3 }]), 2,
    );
    expect(out.data[0][OTHERS_SLOT]).toBe(3);
    expect(out.slotCount).toBe(2);
  });
});

describe('each month picks its own five', () => {
  test('a category can sit in a different slot from month to month', () => {
    const out = buildTopSlots(series(
      ['Ko\'ylak', 'Sumka'],
      ['Jan', { 'Ko\'ylak': 50, Sumka: 2 }],
      ['Feb', { 'Ko\'ylak': 10, Sumka: 60 }],
    ));
    const [jan, feb] = out.data;
    expect(jan[`${slotKey(0)}Name`]).toBe('Ko\'ylak');
    expect(feb[`${slotKey(0)}Name`]).toBe('Sumka');
  });

  test('but its colour does not move with it — this is what keeps the chart readable', () => {
    const out = buildTopSlots(series(
      ['Ko\'ylak', 'Sumka'],
      ['Jan', { 'Ko\'ylak': 50, Sumka: 2 }],
      ['Feb', { 'Ko\'ylak': 10, Sumka: 60 }],
    ));
    // Position is per month; colour is per category for the whole chart. Painting by slot
    // instead would make one colour mean two different categories in two bars.
    expect(out.categoryColors['Ko\'ylak']).toBeTruthy();
    expect(out.categoryColors.Sumka).toBeTruthy();
    expect(out.categoryColors['Ko\'ylak']).not.toBe(out.categoryColors.Sumka);
  });

  test('a category big in one month and absent in another appears only where it sold', () => {
    const out = buildTopSlots(series(
      ['A', 'B'],
      ['Jan', { A: 10, B: 0 }],
      ['Feb', { A: 0, B: 40 }],
    ));
    expect(out.data[0][`${slotKey(0)}Name`]).toBe('A');
    expect(out.data[0][slotKey(1)]).toBeUndefined();
    expect(out.data[1][`${slotKey(0)}Name`]).toBe('B');
    expect(out.data[1][slotKey(1)]).toBeUndefined();
  });

  test('slotCount is the widest month, so the chart renders enough segments for all of them', () => {
    const out = buildTopSlots(series(
      ['A', 'B', 'C'],
      ['Jan', { A: 10, B: 0, C: 0 }],
      ['Feb', { A: 5, B: 4, C: 3 }],
    ));
    expect(out.slotCount).toBe(3);
  });
});

describe('colours', () => {
  test('are handed out by overall size, so the biggest sellers lead the palette', () => {
    const out = buildTopSlots(series(
      ['Small', 'Big'],
      ['Jan', { Small: 1, Big: 100 }],
    ));
    const palette = Object.values(out.categoryColors);
    expect(out.categoryColors.Big).toBe(palette[0]);
    expect(out.categoryColors.Small).not.toBe(out.categoryColors.Big);
  });

  test('more categories than the palette still all get one', () => {
    const names = Array.from({ length: 14 }, (_, i) => `C${String(i).padStart(2, '0')}`);
    const values = Object.fromEntries(names.map((n, i) => [n, 14 - i]));
    const out = buildTopSlots(series(names, ['Jan', values]));
    names.forEach((n) => expect(out.categoryColors[n]).toBeTruthy());
  });
});

describe('nothing to draw', () => {
  test('no series at all', () => {
    expect(buildTopSlots(undefined).data).toEqual([]);
    expect(buildTopSlots({ data: [], keys: [] }).data).toEqual([]);
  });

  test('months carry their labels through for the axis', () => {
    const out = buildTopSlots(series(['A'], ['Mar', { A: 3 }]));
    expect(out.data[0].monthLabel).toBe('Mar');
    expect(out.data[0].month_key).toBe('2026-Mar');
  });
});

/**
 * The weekday chart ("Kategoriya bo'yicha o'rtacha dona") feeds the same builder, from
 * `buildNetWeekdayAverages` instead. Two things differ and both are load-bearing: the bucket is
 * identified by `weekday_label` with no month key at all, and the values are averages rather
 * than counts.
 */
describe('weekday rows', () => {
  function weekdays(keys, ...days) {
    return {
      keys,
      data: days.map(([weekday_label, values]) => ({ weekday_label, ...values })),
    };
  }

  test('the weekday label is carried through, with no month fields invented', () => {
    const out = buildTopSlots(weekdays(['A'], ['Dushanba', { A: 3.5 }]));
    expect(out.data[0].weekday_label).toBe('Dushanba');
    expect(out.data[0]).not.toHaveProperty('monthLabel');
    expect(out.data[0]).not.toHaveProperty('month_key');
  });

  test('averages are kept as they are, not rounded to whole units', () => {
    const out = buildTopSlots(weekdays(['A', 'B'], ['Juma', { A: 0.4, B: 2.5 }]));
    expect(out.data[0][slotKey(0)]).toBe(2.5);
    expect(out.data[0][slotKey(1)]).toBe(0.4);
  });

  test('a category averaging zero on a weekday is dropped, same as a month', () => {
    const out = buildTopSlots(weekdays(['A', 'B'], ['Yakshanba', { A: 1.2, B: 0 }]));
    expect(out.data[0][`${slotKey(0)}Name`]).toBe('A');
    expect(out.data[0][slotKey(1)]).toBeUndefined();
  });

  test('the leftover group sums without floating-point noise on hover', () => {
    const out = buildTopSlots(
      weekdays(['A', 'B', 'C'], ['Chorshanba', { A: 9, B: 1.1, C: 2.2 }]), 1,
    );
    // 1.1 + 2.2 is 3.3000000000000003 in raw arithmetic, and that would be printed.
    expect(out.data[0][OTHERS_SLOT]).toBe(3.3);
  });

  test('each weekday picks its own top sellers, colour still following the category', () => {
    const out = buildTopSlots(weekdays(
      ['Ko\'ylak', 'Sumka'],
      ['Dushanba', { 'Ko\'ylak': 5, Sumka: 1 }],
      ['Seshanba', { 'Ko\'ylak': 1, Sumka: 8 }],
    ));
    expect(out.data[0][`${slotKey(0)}Name`]).toBe('Ko\'ylak');
    expect(out.data[1][`${slotKey(0)}Name`]).toBe('Sumka');
    expect(out.categoryColors['Ko\'ylak']).not.toBe(out.categoryColors.Sumka);
  });
});
