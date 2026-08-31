import {
  normalizeScan,
  looksLikeLayerCode,
  parseLayerRef,
  buildBarcodeIndex,
} from './layerBarcode';

describe('normalizeScan', () => {
  // Every one of these is the same physical label, differing only in how the scanner was
  // configured and what the OS thought the keyboard was.
  it.each([
    ['LD00004821', 'no suffix'],
    ['LD00004821\r\n', 'CRLF suffix'],
    ['LD00004821\t', 'TAB suffix'],
    ['  LD00004821  ', 'padded with spaces'],
    ['ld00004821', 'unshifted keys'],
    ['LD00004821 ', 'the non-breaking space a wedge sometimes emits'],
    ['ЛД00004821', 'read through a Cyrillic keyboard layout'],
  ])('collapses %j (%s) to the stored form', (input) => {
    expect(normalizeScan(input)).toBe('LD00004821');
  });

  it('returns empty for nothing usable', () => {
    ['', '   ', null, undefined].forEach((v) => expect(normalizeScan(v)).toBe(''));
  });
});

describe('looksLikeLayerCode', () => {
  it('accepts a code the backend could have issued, including a suffixed one', () => {
    expect(looksLikeLayerCode('LD00004821')).toBe(true);
    expect(looksLikeLayerCode('LD000048214F2A')).toBe(true); // collision fallback form
  });

  // These must stay silent rather than beep: the hook fires on any fast keystroke burst, and
  // a bare number is far more likely to be a stray than a label.
  it.each(['', 'LD', 'LDX4821', '4821', 'hello', '4066748291045'])(
    'rejects %j so the scan is ignored in silence', (v) => {
      expect(looksLikeLayerCode(v)).toBe(false);
    },
  );

  it('rejects a runaway burst rather than treating it as a code', () => {
    expect(looksLikeLayerCode(`LD${'9'.repeat(300)}`)).toBe(false);
  });
});

describe('parseLayerRef — the manual-entry path only', () => {
  it('expands a bare number typed off the Inventory table', () => {
    expect(parseLayerRef('4821')).toBe('LD00004821');
  });

  it('passes a full code through', () => {
    expect(parseLayerRef(' ld00004821 ')).toBe('LD00004821');
  });

  it('is the only lenient path — normalizeScan alone leaves a bare number unmatched', () => {
    // The strictness split is the point: what the hook sees must not resolve a bare number.
    expect(looksLikeLayerCode(normalizeScan('4821'))).toBe(false);
  });

  it('rejects what is neither', () => {
    ['', 'abc', 'LDX'].forEach((v) => expect(parseLayerRef(v)).toBe(''));
  });
});

describe('buildBarcodeIndex', () => {
  const items = [
    { value: '1', layer: { barcode: 'LD00000001' } },
    { value: '2', layer: { barcode: 'ld00000002' } },
  ];
  const get = (i) => i.layer.barcode;

  it('finds an item by its normalised code', () => {
    const index = buildBarcodeIndex(items, get);
    expect(index.get(normalizeScan('LD00000001\r\n')).value).toBe('1');
    expect(index.get(normalizeScan('LD00000002')).value).toBe('2');
  });

  it('skips layers with no barcode rather than keying them under empty string', () => {
    // Otherwise every unrecognised scan would collide with them and fill a sale line.
    const index = buildBarcodeIndex([...items, { value: '3', layer: { barcode: null } }], get);
    expect(index.size).toBe(2);
    expect(index.has('')).toBe(false);
  });

  it('tolerates an empty or missing list', () => {
    expect(buildBarcodeIndex([], get).size).toBe(0);
    expect(buildBarcodeIndex(null, get).size).toBe(0);
  });
});
