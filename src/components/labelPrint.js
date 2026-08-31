import JsBarcode from 'jsbarcode';

/**
 * The 40×30mm sticker that goes on a box.
 *
 * Pure: takes a layer's label data and returns a whole HTML document as a string, which
 * `printHtml` then prints from an isolated iframe. Nothing here touches React or the page.
 *
 * **Rendered to SVG, never canvas.** A canvas rasterises at the screen's ~96dpi and the printer
 * driver then scales that up to 203dpi, smearing every bar edge — which is the usual reason a
 * label prints beautifully and refuses to scan. SVG is vector, so the driver rasterises it at the
 * printer's own density.
 */

const LABEL_MM = { width: 40, height: 30 };
export const MAX_COPIES = 100;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Code128 as an inline SVG string. Returns '' if the code cannot be encoded. */
export function renderCode128Svg(code) {
  if (!code) return '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, String(code), {
      format: 'CODE128',
      // The human-readable line is rendered as HTML below, where it can be styled to fit;
      // jsbarcode's own text uses its internal metrics and would fight the layout.
      displayValue: false,
      margin: 0,
      width: 2,
      height: 60,
    });
  } catch {
    return '';
  }
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('class', 'label__code');
  return svg.outerHTML;
}

const STYLES = `
  @page { size: ${LABEL_MM.width}mm ${LABEL_MM.height}mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${LABEL_MM.width}mm; background: #fff; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  .label {
    width: ${LABEL_MM.width}mm;
    height: ${LABEL_MM.height}mm;
    /* A quiet border all round. Thermal stock is never fed perfectly straight, so content that
       runs to the edge comes out looking clipped even when it is not — and a barcode with no
       quiet zone beside it genuinely does stop scanning. 2.5mm leaves 35x25mm of content, which
       still gives the symbol ~2.7 printer dots per module at 203dpi: comfortably above the ~2
       where cheap heads start to struggle. Widening these margins further eats into that. */
    padding: 2.5mm;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    /* No webfonts: one that has not loaded when print() fires renders in fallback metrics and
       reflows the label after the page count has been decided. */
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    text-align: center;
    break-after: page;
    page-break-after: always;
  }
  /* Without this every job ends on a blank sticker and an extra feed. */
  .label:last-child { break-after: auto; page-break-after: auto; }
  /* nowrap + ellipsis are load-bearing, not cosmetic: a long model name that wraps pushes the
     label past 30mm, and one pixel of overflow prints EVERY label on two pages — two hundred
     labels becomes four hundred and the roll runs out mid-run. */
  .label__title {
    font-size: 7pt; font-weight: 700; line-height: 1.05;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .label__attrs {
    font-size: 6pt; line-height: 1.05;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* The biggest thing on the label, because it is what a customer reads. */
  .label__price { font-size: 11pt; font-weight: 700; line-height: 1.1; }
  .label__code { display: block; width: 100%; height: 8.5mm; }
  .label__human {
    font-size: 5.5pt; letter-spacing: 0.3px; line-height: 1;
  }
`;

function labelMarkup(label, barcodeSvg) {
  const title = [label.brand, label.model].filter(Boolean).join(' ');
  const attrs = [label.size, label.color].filter(Boolean).join(' · ');
  return `
    <div class="label">
      <div class="label__title">${esc(title)}</div>
      <div class="label__attrs">${esc(attrs)}</div>
      <div class="label__price">${esc(label.price)}</div>
      ${barcodeSvg}
      <div class="label__human">${esc(label.code)} · #${esc(label.layerNo)}</div>
    </div>`;
}

/** How many stickers one entry is worth, clamped the way the builder will actually render it. */
export function copiesFor(copies) {
  return Math.min(MAX_COPIES, Math.max(1, parseInt(copies, 10) || 1));
}

/** Total stickers a batch selection will produce — what the toolbar counter shows. */
export function totalLabelCount(entries) {
  return (entries || []).reduce((sum, entry) => sum + copiesFor(entry.copies), 0);
}

function labelDocument(body, title) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${STYLES}</style></head>
<body>${body}</body></html>`;
}

function repeatLabel(label, copies) {
  // Encoded once and repeated — the symbol is identical on every copy, and re-encoding it a
  // hundred times is a hundred DOM builds for the same string.
  const barcodeSvg = renderCode128Svg(label.code);
  return Array.from({ length: copiesFor(copies) }, () => labelMarkup(label, barcodeSvg)).join('');
}

/** `copies` labels for one layer, as one printable document. */
export function buildLabelSheetHtml(label, copies) {
  return labelDocument(repeatLabel(label, copies), label.code);
}

/**
 * One document for several layers at once — the batch print.
 *
 * `entries` is `[{ label, copies }]`, kept in the order the table showed them so the stickers come
 * off the roll in the same order as the rows that were ticked. That matters when someone is
 * working down a shelf with the screen beside them.
 */
export function buildBatchLabelSheetHtml(entries) {
  const usable = (entries || []).filter((entry) => entry && entry.label && entry.label.code);
  if (!usable.length) return '';
  const body = usable.map((entry) => repeatLabel(entry.label, entry.copies)).join('');
  return labelDocument(body, `${usable.length} × labels`);
}
