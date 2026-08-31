/**
 * Normalising a scanned barcode so it can be matched against a layer's stored `barcode`.
 *
 * The code is generated and stored by the backend (`erp_app/layer_barcode.py`), so nothing here
 * invents one — this module only cleans up what the scanner typed, and the caller looks the result
 * up. Matching the stored value rather than decoding an id back out is what lets a factory EAN be
 * written into the same column later and resolve with no change on this side.
 *
 * A keyboard-wedge scanner is a keyboard, so what arrives depends on how the device is configured
 * and what the operating system thinks the keyboard is. All of these are the same label:
 *
 *   'LD00004821\r\n'   suffix set to CRLF
 *   'LD00004821\t'     suffix set to TAB
 *   ' ld00004821 '     a wedge that sends unshifted keys
 *   'ЛД00004821'       read through a Cyrillic keyboard layout
 */

/** Cyrillic lookalikes for the two prefix letters, for a scan read under a Cyrillic layout. */
const CYRILLIC_FIXUPS = [[/Л/g, 'L'], [/Д/g, 'D']];

/**
 * A code the backend could have issued: the `LD` prefix, the padded id, and — only in the
 * collision case — a suffix of exactly four hex characters (`secrets.token_hex(2).upper()`).
 *
 * The suffix length is exact rather than `*` on purpose. An open-ended hex run also matches
 * digits, so `LD` followed by three hundred nines would qualify as a code and a runaway keystroke
 * burst would earn an error beep instead of the silence it deserves.
 */
const LAYER_CODE_RE = /^LD\d{1,12}(?:[0-9A-F]{4})?$/;

/** A bare layer number, as a person would type it reading `#4821` off the Inventory table. */
const BARE_NUMBER_RE = /^\d{1,12}$/;

const PAD = 8;

/**
 * Clean a raw scan into the form a stored barcode is held in. Returns '' for anything unusable.
 *
 * Strips every kind of whitespace — including the U+00A0 a wedge sometimes emits in place of a
 * space — then upper-cases, then repairs Cyrillic prefix letters.
 */
export function normalizeScan(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\s ]+/g, '').toUpperCase();
  if (!s) return '';
  return CYRILLIC_FIXUPS.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

/**
 * Does this look like one of our labels?
 *
 * This gates *feedback*, not resolution. The scan hook fires on any fast keystroke burst, so a
 * string that does not look like a label is ignored in silence — beeping at someone typing quickly
 * would be maddening. One that does look like a label but matches no layer has earned an error
 * message, because the operator is holding a box and needs to know why it did not scan.
 */
export function looksLikeLayerCode(value) {
  return LAYER_CODE_RE.test(normalizeScan(value));
}

/**
 * The lenient parser, for the manual-entry box only.
 *
 * Accepts a bare number and expands it to padded form, so someone reading `#4821` off the
 * Inventory table can type `4821`. Deliberately **not** used by the scan hook: from a keystroke
 * burst a bare number is far more likely to be a stray than an intention, and keeping the two
 * strictness levels at separate call sites is what stops the lenient one leaking into the hook.
 */
export function parseLayerRef(raw) {
  const s = normalizeScan(raw);
  if (!s) return '';
  if (BARE_NUMBER_RE.test(s)) return `LD${s.padStart(PAD, '0')}`;
  return LAYER_CODE_RE.test(s) ? s : '';
}

/**
 * Index picker items by their layer's stored barcode, for O(1) lookup per scan.
 *
 * `getBarcode` pulls the code out of whatever shape the caller holds — a picker item wrapping a
 * layer, or a bare layer row. Layers with no barcode are skipped rather than keyed under '',
 * which would make every unrecognised scan collide with them.
 */
export function buildBarcodeIndex(items, getBarcode) {
  const index = new Map();
  (items || []).forEach((item) => {
    const code = normalizeScan(getBarcode(item));
    if (code && !index.has(code)) index.set(code, item);
  });
  return index;
}
