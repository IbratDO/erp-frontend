/**
 * One inventarizatsiya, as a file somebody can file.
 *
 * The rest of the app downloads tables by reading the rendered DOM (`utils/tableCsv`), and for a
 * page you are looking at that is the right way round — the file then matches the screen exactly.
 * A single count is the one case where it is not: the whole point of the download is the *detail*,
 * every layer the count judged, and the history page deliberately does not render that. Reading
 * the DOM would export the summary row and call it an audit record.
 *
 * So this builds the matrix from the report the API returns, and `tableCsv` still turns it into
 * the file. Splitting it here rather than inside the page keeps it testable without a browser, and
 * keeps the two exports on the page — the history list, and one count — from growing two different
 * ideas of what a CSV looks like.
 *
 * Everything is a string by the time it leaves here. The labels come in from the caller rather
 * than being looked up, because this module has no business knowing which language the shop reads.
 */

/** A blank line between the header block and the table. Excel is happy with it; people need it. */
const GAP = [''];

/**
 * The count's own details, above the lines.
 *
 * A bare table of layers is not much use six months later when nobody remembers which count it
 * was, so the file leads with who, when, and what was decided.
 */
export function countMetaRows(count, summary, labels) {
  const s = summary || {};
  return [
    [labels.title, `#${count?.id ?? ''}`],
    [labels.startedAt, labels.formatDateTime(count?.started_at)],
    [labels.startedBy, count?.started_by_name || ''],
    [labels.scope, labels.scopeName(count?.scope)],
    [labels.status, labels.statusName(count?.status)],
    [labels.appliedAt, labels.formatDateTime(count?.applied_at)],
    [labels.appliedBy, count?.applied_by_name || ''],
    GAP,
    [labels.scannedLines, num(s.scanned_lines)],
    [labels.countedUnits, num(s.counted_units)],
    [labels.missingUnits, num(s.missing_units)],
    [labels.surplusUnits, num(s.surplus_units)],
    [labels.notCounted, num(s.not_counted)],
    [labels.lossUsd, money(s.loss_usd)],
    [labels.lossUzs, money(s.loss_uzs)],
  ];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

/** Money as a plain decimal, not a formatted price: this cell is meant to be summed. */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

function productName(line) {
  const p = line?.product_detail;
  if (!p) return '';
  return [p.brand, p.model].filter(Boolean).join(' | ');
}

/**
 * Every layer the count reached a verdict on.
 *
 * Lines nobody looked at are left out. They only occur in a partial count, where "not counted"
 * means the person never went to that shelf — listing a few hundred of them would bury the
 * handful of rows the file exists for, and the count of them is in the header block anyway.
 */
export function countLineRows(verdicts, labels) {
  return (verdicts || [])
    .filter((v) => v && v.kind !== 'not_counted')
    .map((v) => {
      const line = v.line || {};
      return [
        `#${v.batch_id}`,
        line.barcode || '',
        productName(line),
        line.product_detail?.size || '',
        line.product_detail?.color || '',
        num(v.expected_at_start),
        num(v.moved_since_start),
        num(v.system_now),
        v.counted == null ? '' : num(v.counted),
        // The sign is the message here: a leading + says the shelf had more than the books did.
        v.difference > 0 ? `+${v.difference}` : num(v.difference),
        labels.kindName(v.kind),
        money(v.loss_usd),
        money(v.loss_uzs),
      ];
    });
}

/** The whole file: the count's details, a gap, then its lines under their headings. */
export function countReportToMatrix(report, labels) {
  const count = report?.stock_count;
  const rows = countLineRows(report?.verdicts, labels);
  return [
    ...countMetaRows(count, report?.totals, labels),
    GAP,
    labels.columns,
    ...rows,
  ];
}

/** "inventarizatsiya-12" — `csvFilename` adds the date and the extension. */
export function countExportFilename(count, base = 'inventarizatsiya') {
  return `${base}-${count?.id ?? ''}`;
}
