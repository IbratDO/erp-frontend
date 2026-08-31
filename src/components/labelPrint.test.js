import {
  MAX_COPIES,
  buildBatchLabelSheetHtml,
  buildLabelSheetHtml,
  renderCode128Svg,
  totalLabelCount,
} from './labelPrint';

const LABEL = {
  code: 'LD00004821',
  layerNo: 4821,
  brand: 'Nike',
  model: 'Air Max 90',
  size: '42',
  color: 'Qora',
  price: '1 250 000 uzs',
  maxCopies: 9,
};

const countOf = (html, needle) => html.split(needle).length - 1;

describe('the printed sheet', () => {
  it('holds one label per copy', () => {
    expect(countOf(buildLabelSheetHtml(LABEL, 3), 'class="label"')).toBe(3);
  });

  it('asks for exactly the 40x30mm stock, with no margin', () => {
    // If this drifts, Chrome falls back to A4 and prints one label in the corner of a page.
    const html = buildLabelSheetHtml(LABEL, 1);
    expect(html).toContain('size: 40mm 30mm');
    expect(html).toContain('margin: 0');
  });

  it('centres every line', () => {
    // Set once on .label and inherited, so a new row cannot be added left-aligned by accident.
    expect(buildLabelSheetHtml(LABEL, 1)).toContain('text-align: center');
  });

  it('keeps content off the edge of the sticker', () => {
    // Thermal stock is never fed perfectly straight, and a barcode with no quiet zone beside it
    // stops scanning. Shrinking this padding is what would bring the two back.
    expect(buildLabelSheetHtml(LABEL, 1)).toContain('padding: 2.5mm');
  });

  it('lets only the last label skip the page break', () => {
    // Otherwise every job ends on a blank sticker and an extra feed.
    expect(buildLabelSheetHtml(LABEL, 2)).toContain('.label:last-child { break-after: auto');
  });

  it('pins the label height so a long name cannot spill onto a second page', () => {
    // One pixel of overflow doubles the page count and the roll runs out mid-run.
    const html = buildLabelSheetHtml(LABEL, 1);
    expect(html).toContain('height: 30mm');
    expect(html).toContain('overflow: hidden');
    expect(html).toContain('white-space: nowrap');
  });

  it('prints every field the operator and the customer need', () => {
    const html = buildLabelSheetHtml(LABEL, 1);
    ['Nike', 'Air Max 90', '42', 'Qora', '1 250 000', 'LD00004821', '#4821']
      .forEach((piece) => expect(html).toContain(piece));
  });

  it('separates brand from model with a bar', () => {
    // Many models are themselves two words, so a plain space leaves no way to tell where the
    // brand ends: "On club T" reads as three words.
    expect(buildLabelSheetHtml(LABEL, 1)).toContain('Nike | Air Max 90');
  });

  it('prints no stray bar when a product has only one of the two', () => {
    const html = buildLabelSheetHtml({ ...LABEL, model: '' }, 1);
    expect(html).toContain('Nike');
    expect(html).not.toContain('Nike |');
  });

  it('carries the code in the barcode as well as in the human-readable line', () => {
    const html = buildLabelSheetHtml(LABEL, 1);
    expect(html).toContain('<svg');
    expect(html).toContain('class="label__code"');
    expect(countOf(html, 'LD00004821')).toBeGreaterThanOrEqual(2); // <title> and the human line
  });
});

describe('copies', () => {
  it.each([[0, 1], [-4, 1], ['', 1], [null, 1], ['abc', 1]])(
    'clamps %j up to %i', (input, expected) => {
      expect(countOf(buildLabelSheetHtml(LABEL, input), 'class="label"')).toBe(expected);
    },
  );

  it('caps a runaway number rather than burning the roll', () => {
    expect(countOf(buildLabelSheetHtml(LABEL, 5000), 'class="label"')).toBe(MAX_COPIES);
  });
});

describe('escaping', () => {
  it('escapes a product name that would otherwise corrupt the document', () => {
    const html = buildLabelSheetHtml({ ...LABEL, model: 'A & B <x>' }, 1);
    expect(html).toContain('A &amp; B &lt;x&gt;');
    expect(html).not.toContain('<x>');
  });
});

describe('batch printing several layers', () => {
  const other = { ...LABEL, code: 'LD00001224', layerNo: 1224, model: 'Pegasus' };

  it('puts every selected layer in one document, one label per unit', () => {
    const html = buildBatchLabelSheetHtml([
      { label: LABEL, copies: 2 },
      { label: other, copies: 3 },
    ]);
    expect(countOf(html, 'class="label"')).toBe(5);
    expect(countOf(html, 'LD00004821')).toBeGreaterThanOrEqual(2);
    expect(html).toContain('Pegasus');
  });

  it('keeps the table\'s order, so stickers match the rows that were ticked', () => {
    const html = buildBatchLabelSheetHtml([{ label: other, copies: 1 }, { label: LABEL, copies: 1 }]);
    expect(html.indexOf('Pegasus')).toBeLessThan(html.indexOf('Air Max 90'));
  });

  it('emits one document, not one per layer', () => {
    const html = buildBatchLabelSheetHtml([{ label: LABEL, copies: 1 }, { label: other, copies: 1 }]);
    expect(countOf(html, '<!DOCTYPE html>')).toBe(1);
    expect(countOf(html, '@page')).toBe(1);
  });

  it('skips entries with no barcode rather than printing a blank sticker', () => {
    const html = buildBatchLabelSheetHtml([
      { label: LABEL, copies: 1 },
      { label: { ...LABEL, code: '' }, copies: 4 },
      null,
    ]);
    expect(countOf(html, 'class="label"')).toBe(1);
  });

  it('returns nothing at all for an empty selection', () => {
    expect(buildBatchLabelSheetHtml([])).toBe('');
    expect(buildBatchLabelSheetHtml(null)).toBe('');
  });
});

describe('totalLabelCount — the number shown before the print dialog opens', () => {
  it('sums the copies across the selection', () => {
    expect(totalLabelCount([{ copies: 2 }, { copies: 5 }, { copies: 1 }])).toBe(8);
  });

  it('counts what will actually be printed, clamps included', () => {
    // The counter is the only guard against spending a roll, so it must not promise 0 or 5000.
    expect(totalLabelCount([{ copies: 0 }, { copies: 5000 }])).toBe(1 + MAX_COPIES);
  });

  it('is zero for nothing selected', () => {
    expect(totalLabelCount([])).toBe(0);
    expect(totalLabelCount(null)).toBe(0);
  });
});

describe('renderCode128Svg', () => {
  it('returns an SVG, not a canvas — a raster smears at 203dpi and stops scanning', () => {
    const svg = renderCode128Svg('LD00004821');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
  });

  it('returns empty rather than throwing when there is no code', () => {
    expect(renderCode128Svg('')).toBe('');
    expect(renderCode128Svg(null)).toBe('');
  });
});
