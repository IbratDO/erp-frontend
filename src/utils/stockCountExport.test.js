/**
 * Downloading one inventarizatsiya.
 *
 * The file is the thing that outlives the screen: it gets filed, printed, and argued over months
 * later. So the properties tested here are the ones that make it readable by somebody who was not
 * there — it says which count it is, it distinguishes a surplus from a shortage, and the money
 * columns are numbers Excel can add up rather than pretty strings.
 */
import {
  countExportFilename,
  countLineRows,
  countMetaRows,
  countReportToMatrix,
} from './stockCountExport';

const labels = {
  title: 'Inventarizatsiya',
  startedAt: 'Sana',
  startedBy: 'Kim',
  scope: 'Turi',
  status: 'Holati',
  appliedAt: 'Tuzatilgan sana',
  appliedBy: 'Kim tuzatdi',
  scannedLines: 'Skanerlangan',
  countedUnits: 'Topilgan dona',
  missingUnits: 'Kam',
  surplusUnits: 'Ortiq',
  notCounted: 'Sanalmadi',
  lossUsd: 'Zarar USD',
  lossUzs: 'Zarar UZS',
  columns: ['Qatlam', 'Shtrix', 'Mahsulot', "O'lcham", 'Rang', 'Boshlanishida',
    'Sotilgan', 'Tizimda', 'Topildi', 'Farq', 'Natija', 'Zarar USD', 'Zarar UZS'],
  formatDateTime: (v) => (v ? `dt(${v})` : ''),
  scopeName: (v) => `scope(${v})`,
  statusName: (v) => `status(${v})`,
  kindName: (v) => `kind(${v})`,
};

const count = {
  id: 12,
  started_at: '2026-09-05T10:00:00Z',
  started_by_name: 'admin',
  scope: 'partial',
  status: 'applied',
  applied_at: '2026-09-05T11:00:00Z',
  applied_by_name: 'founder',
};

const verdict = (over = {}) => ({
  batch_id: 41,
  kind: 'short',
  expected_at_start: 10,
  moved_since_start: 1,
  system_now: 9,
  counted: 7,
  difference: -2,
  missing: 2,
  loss_usd: '20.00',
  loss_uzs: '0',
  line: {
    barcode: 'LD00000041',
    product_detail: { brand: 'On', model: 'Cloud', size: '42', color: 'qora' },
  },
  ...over,
});

const cellAfter = (rows, label) => (rows.find((r) => r[0] === label) || [])[1];

describe('the header block names the count', () => {
  const rows = countMetaRows(count, { missing_units: 2, loss_usd: '20.00' }, labels);

  it('carries the id, so a filed copy can be traced back', () => {
    expect(cellAfter(rows, 'Inventarizatsiya')).toBe('#12');
  });

  it('names who counted and who corrected the books', () => {
    expect(cellAfter(rows, 'Kim')).toBe('admin');
    expect(cellAfter(rows, 'Kim tuzatdi')).toBe('founder');
  });

  it('leaves the applied fields blank on a count nobody approved', () => {
    const open = countMetaRows({ ...count, applied_at: null, applied_by_name: null }, {}, labels);
    expect(cellAfter(open, 'Tuzatilgan sana')).toBe('');
    expect(cellAfter(open, 'Kim tuzatdi')).toBe('');
  });

  it('writes a missing total as zero rather than leaving a hole', () => {
    // An empty cell reads as "not measured". Nothing missing is a result, and a real one.
    expect(cellAfter(countMetaRows(count, {}, labels), 'Kam')).toBe('0');
  });

  it('survives a count with no summary at all', () => {
    expect(() => countMetaRows(count, null, labels)).not.toThrow();
  });
});

describe('the line rows', () => {
  it('write money as a number Excel can add up', () => {
    // The screen shows "20.00 y.e"; a column of those sums to nothing.
    const [row] = countLineRows([verdict()], labels);
    expect(row[11]).toBe('20.00');
  });

  it('leave a zero loss blank rather than printing 0.00 down the page', () => {
    expect(countLineRows([verdict({ loss_uzs: '0' })], labels)[0][12]).toBe('');
  });

  it('mark a surplus with a leading plus so it cannot be read as a shortage', () => {
    const [row] = countLineRows([verdict({ kind: 'over', difference: 3, missing: 0 })], labels);
    expect(row[9]).toBe('+3');
  });

  it('leave out layers nobody looked at', () => {
    // Only possible in a partial count, where a few hundred of them would bury the rows that
    // matter. The tally of them is in the header block.
    const rows = countLineRows([verdict(), verdict({ batch_id: 9, kind: 'not_counted' })], labels);
    expect(rows.map((r) => r[0])).toEqual(['#41']);
  });

  it('keep a line whose product is gone from the join', () => {
    const [row] = countLineRows([verdict({ line: { barcode: 'LD1' } })], labels);
    expect(row[0]).toBe('#41');
    expect(row[2]).toBe('');
  });

  it.each([[[]], [null], [undefined]])('survive %j', (input) => {
    expect(countLineRows(input, labels)).toEqual([]);
  });

  it('survive a malformed verdict', () => {
    expect(() => countLineRows([null, {}, undefined], labels)).not.toThrow();
  });
});

describe('the whole file', () => {
  const matrix = countReportToMatrix(
    { stock_count: count, totals: { missing_units: 2 }, verdicts: [verdict()] },
    labels,
  );

  it('puts the headings above the lines, not at the top of the file', () => {
    const headingRow = matrix.findIndex((r) => r[0] === 'Qatlam');
    const lineRow = matrix.findIndex((r) => r[0] === '#41');
    expect(headingRow).toBeGreaterThan(0);
    expect(lineRow).toBe(headingRow + 1);
  });

  it('is still a valid file for a count that found nothing wrong', () => {
    const empty = countReportToMatrix(
      { stock_count: count, totals: {}, verdicts: [] }, labels,
    );
    expect(empty[empty.length - 1]).toEqual(labels.columns);
  });

  it('does not throw on an empty report', () => {
    expect(() => countReportToMatrix(null, labels)).not.toThrow();
  });
});

describe('the filename', () => {
  it('names the count, so a folder of them does not collide', () => {
    expect(countExportFilename(count)).toBe('inventarizatsiya-12');
  });
});
