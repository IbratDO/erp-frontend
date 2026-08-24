/**
 * Reading a rendered table back out as a file.
 *
 * The parts worth pinning are the ones that fail quietly: a quote or a semicolon inside a
 * customer's name silently splitting a row into two, an expanded detail table being flattened
 * into whichever column it happened to sit under, and the sort arrow riding along into a column
 * heading.
 *
 * The encoding is here too, because the first version got it wrong in a way nobody could have
 * predicted from reading it: a `sep=;` hint on the first line makes Excel ignore the byte-order
 * mark that follows, so every Uzbek apostrophe and em-dash arrived as `Ogâ€˜irlik` and `â€”`.
 */
import {
  csvFilename, matrixToCsv, tableToMatrix,
} from './tableCsv';

function tableFrom(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('table');
}

describe('reading the table off the screen', () => {
  test('headers first, then the rows', () => {
    const table = tableFrom(`
      <table>
        <thead><tr><th>ID</th><th>Mijoz</th></tr></thead>
        <tbody>
          <tr><td>#1</td><td>Ali</td></tr>
          <tr><td>#2</td><td>Bek</td></tr>
        </tbody>
      </table>`);
    expect(tableToMatrix(table)).toEqual([
      ['ID', 'Mijoz'],
      ['#1', 'Ali'],
      ['#2', 'Bek'],
    ]);
  });

  test('buttons in the actions column leave an empty cell, not their label', () => {
    const table = tableFrom(`
      <table>
        <thead><tr><th>ID</th><th>Amallar</th></tr></thead>
        <tbody><tr><td>#1</td><td><button>Tahrirlash</button></td></tr></tbody>
      </table>`);
    expect(tableToMatrix(table)[1]).toEqual(['#1', '']);
  });

  test('a two-line cell keeps both lines, separated', () => {
    const table = tableFrom(`
      <table><tbody><tr><td><div>Ali</div><div>+998901234567</div></td></tr></tbody></table>`);
    expect(tableToMatrix(table)[0]).toEqual(['Ali +998901234567']);
  });

  test('an expanded row holding its own table is skipped rather than flattened', () => {
    const table = tableFrom(`
      <table>
        <thead><tr><th>ID</th><th>Holat</th></tr></thead>
        <tbody>
          <tr><td>#1</td><td>Ochiq</td></tr>
          <tr><td colspan="2"><table><tbody><tr><td>to'lov 1</td></tr></tbody></table></td></tr>
          <tr><td>#2</td><td>Yopiq</td></tr>
        </tbody>
      </table>`);
    expect(tableToMatrix(table)).toEqual([
      ['ID', 'Holat'],
      ['#1', 'Ochiq'],
      ['#2', 'Yopiq'],
    ]);
  });

  test('the whitespace JSX leaves behind is collapsed', () => {
    const table = tableFrom(`
      <table><tbody><tr><td>
          2 108 000
          so'm
      </td></tr></tbody></table>`);
    expect(tableToMatrix(table)[0]).toEqual(["2 108 000 so'm"]);
  });

  test('no table, no rows', () => {
    expect(tableToMatrix(null)).toEqual([]);
    expect(tableToMatrix(tableFrom('<table><tbody></tbody></table>'))).toEqual([]);
  });
});

describe('what Excel receives', () => {
  test('nothing precedes the first row, so the byte-order mark stays first in the file', () => {
    // A `sep=;` line here is what produced `Ogâ€˜irlik` and `â€”` in every download: Excel
    // ignores the mark when it finds one, falls back to Windows-1252, and mangles the lot.
    const csv = matrixToCsv([['a', 'b']]);
    expect(csv.startsWith('sep=')).toBe(false);
    expect(csv.startsWith('a,b')).toBe(true);
  });

  test('rows are comma separated and CRLF terminated', () => {
    expect(matrixToCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
  });

  test('a date keeps its time, even though the separator now sits between them', () => {
    // `formatAppDateTime` writes "23/08/2026, 12:38:08". Unquoted, that one comma split every
    // row of every downloaded file into two.
    expect(matrixToCsv([['#424', '23/08/2026, 12:38:08']]))
      .toBe('#424,"23/08/2026, 12:38:08"\r\n');
  });

  test('a placeholder dash becomes an empty cell, not the character', () => {
    expect(matrixToCsv([['Ali', '—', '–', '-']])).toBe('Ali,,,\r\n');
  });

  test('a dash that is part of a real value is left alone', () => {
    expect(matrixToCsv([['Tez Cargo — Yaponiya', '-5']])).toBe('Tez Cargo — Yaponiya,-5\r\n');
  });

  test('a sort arrow is stripped, so a heading does not change with the sort', () => {
    const table = tableFrom(`
      <table><thead><tr>
        <th><span>Ism<span class="sort-indicator"> ▲</span></span></th>
        <th><span>Telefon</span></th>
      </tr></thead></table>`);
    expect(tableToMatrix(table)[0]).toEqual(['Ism', 'Telefon']);
  });

  test('a comma in a name does not split the row', () => {
    const csv = matrixToCsv([['Ali, Bek', 'x']]);
    expect(csv).toContain('"Ali, Bek",x');
  });

  test('a semicolon is now ordinary text and needs no quoting', () => {
    expect(matrixToCsv([['Ali; Bek', 'x']])).toBe('Ali; Bek,x\r\n');
  });

  test('a quote in a value is doubled, the way CSV expects', () => {
    expect(matrixToCsv([['12" ekran']])).toContain('"12"" ekran"');
  });

  test('a line break inside a cell is kept inside its quotes', () => {
    expect(matrixToCsv([['bir\niki']])).toContain('"bir\niki"');
  });

  test('empty and missing cells come out blank rather than "null"', () => {
    expect(matrixToCsv([['', null, undefined]])).toBe(',,\r\n');
  });
});

describe('the file name', () => {
  const day = new Date(2026, 7, 23);

  test('carries the date so a folder of them sorts itself', () => {
    expect(csvFilename('buyurtmalar', day)).toBe('buyurtmalar-2026-08-23.csv');
  });

  test('months and days are padded', () => {
    expect(csvFilename('sotuvlar', new Date(2026, 0, 5))).toBe('sotuvlar-2026-01-05.csv');
  });

  test('spaces and punctuation become hyphens', () => {
    expect(csvFilename('Asosiy vositalar', day)).toBe('asosiy-vositalar-2026-08-23.csv');
  });

  test('a name with nothing usable in it still produces a file name', () => {
    expect(csvFilename('', day)).toBe('table-2026-08-23.csv');
    expect(csvFilename('—', day)).toBe('table-2026-08-23.csv');
  });
});
