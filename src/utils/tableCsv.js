/**
 * Download the table you are looking at.
 *
 * **It reads the rendered table, not the underlying data.** That is the whole point: the file
 * then matches the screen exactly — the filters you set, the sort you clicked, the currency
 * formatting, the columns a Purchasing Agent cannot see. Building it from the source rows would
 * mean writing out every page's columns a second time, and that second copy would start drifting
 * from the first the day somebody adds a column.
 *
 * The cost is that it exports text rather than typed numbers. A cell reading "2 108 000 so'm"
 * arrives in Excel as those characters. For a table people print, read and file, that is the
 * right trade; if a page ever needs figures Excel can sum, that page needs its own export.
 */

/** Whether this element is the sort arrow, an action button, or anything else not worth exporting. */
const NON_CONTENT = 'button, select, input, textarea, svg, .sort-indicator';

/** Collapse the whitespace JSX leaves behind, and turn a cell's line breaks into spaces. */
function cellText(cell) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll(NON_CONTENT).forEach((el) => el.remove());
  // A cell can stack two lines — a customer's name over their phone number, or an amount in
  // two currencies. Block elements are separated so the two do not run together as one word.
  clone.querySelectorAll('div, p, br').forEach((el) => el.before(document.createTextNode(' ')));
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * The table as a grid of strings, header row first.
 *
 * Only rows belonging to this table are read — a row holding an expanded detail table of its own
 * is skipped rather than flattened into a cell, because its contents are a different shape and
 * would land under the wrong headings.
 */
export function tableToMatrix(table) {
  if (!table) return [];
  const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr')];
  const out = [];
  for (const row of rows) {
    if (row.querySelector('table')) continue;
    const cells = [...row.querySelectorAll(':scope > th, :scope > td')];
    if (!cells.length) continue;
    out.push(cells.map(cellText));
  }
  return out;
}

/** One CSV field: quoted when it holds anything that would otherwise break the row. */
function csvField(value, separator) {
  const text = value == null ? '' : String(value);
  if (text.includes('"') || text.includes('\n') || text.includes(separator)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * A placeholder dash on screen means "nothing here", and in a spreadsheet that is a blank cell.
 *
 * Exporting the character itself gives a column of dashes that cannot be filtered, sorted or
 * counted — the one thing somebody opening this in Excel is likely to want.
 */
const EMPTY_MARKS = new Set(['—', '–', '-', '−']);

/**
 * CSV that Excel opens correctly here.
 *
 * Two things had to be got right and I got both wrong first time, so they are written down.
 *
 * **No `sep=` line.** It used to carry one, naming the separator — and that was the bug behind
 * `Ogâ€˜irlik` and `â€”` in every download. When Excel finds `sep=` on the first line it takes a
 * route into the file that ignores the byte-order mark, assumes Windows-1252, and mangles every
 * character above ASCII. You can have the hint or the encoding, not both; the encoding matters
 * more, so the hint is gone and `downloadCsv` writes the mark.
 *
 * **Comma, not semicolon.** Without the hint, Excel splits on whatever the machine's list
 * separator is, and the shop's is the comma. The evidence was in the broken file itself: every
 * row split in exactly one place, immediately after the date — and `formatAppDateTime` writes
 * "23/08/2026, 12:38:08". The one comma per row was the one place Excel cut.
 *
 * That date is also why `csvField` quoting is not decorative here: it is what keeps the time
 * with its date now that the comma between them is the separator.
 */
export function matrixToCsv(matrix, separator = ',') {
  const body = (matrix || [])
    .map((row) => row
      .map((cell) => (EMPTY_MARKS.has(String(cell ?? '').trim()) ? '' : cell))
      .map((cell) => csvField(cell, separator))
      .join(separator))
    .join('\r\n');
  return `${body}\r\n`;
}

/** "buyurtmalar" -> "buyurtmalar-2026-08-23.csv", so a folder of them sorts by date. */
export function csvFilename(base, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safe = String(base || 'table')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'table';
  return `${safe}-${stamp}.csv`;
}

/**
 * Hand the browser the file. Split out so the rest of this module stays testable.
 *
 * The `﻿` is the byte-order mark, and it is the whole reason Uzbek and Cyrillic text
 * survives the trip into Excel. It only works while nothing precedes it — see `matrixToCsv`.
 */
export function downloadCsv(filename, csv) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked on the next tick: Safari has not finished with the URL when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
