import React, { useLayoutEffect, useRef } from 'react';

/**
 * Money field that shows thousand separators while you type: 1200000 → 1 200 000.
 *
 * `type="number"` cannot do this — browsers reject any character that is not part of a
 * number, so a grouped value is simply not storable in one. This is therefore a text input
 * with `inputMode="decimal"`, which still brings up the numeric keypad on a phone.
 *
 * **The separator is a space, not a comma, on purpose.** A comma is a decimal point in
 * Uzbek and Russian, so "1,200" is genuinely ambiguous — one thousand two hundred, or one
 * and a fifth? A space cannot be misread in any of the app's languages.
 *
 * **`onChange` receives the raw digits, never the formatted text.** Call sites keep doing
 * `onChange={(e) => setState(e.target.value)}` and keep storing "1200000", so nothing
 * downstream — validation, `parseFloat`, the request body — has to know this component
 * exists. Only the display is grouped.
 */

const GROUP = ' '; // thin space: groups digits without looking like a gap between fields

/**
 * Strip everything the caller must not receive, keeping one leading '-' and one '.'.
 *
 * A comma is genuinely ambiguous: a decimal point on a uz/ru keyboard ("1,5" = one and a
 * half) and a thousands separator in anything pasted from Excel or a browser ("1,200,000").
 * Reading every comma as a decimal point would turn a pasted 1,200,000 into 1.2 — a
 * million-fold error in a money field — so the shape decides:
 *
 *   more than one comma            -> grouping ("1,200,000")
 *   a comma with a '.' after it    -> grouping ("1,200.50")
 *   a lone comma + exactly 3 digits-> grouping ("1,500"); nobody writes one and a half that way
 *   anything else                  -> decimal point ("1,5" / "1,50" / "12," mid-typing)
 */
export function parseAmount(text) {
  if (text == null) return '';
  let s = String(text).replace(/[^\d.,-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');

  const commas = (s.match(/,/g) || []).length;
  if (commas) {
    const lastComma = s.lastIndexOf(',');
    const grouping =
      commas > 1
      || s.indexOf('.') > lastComma
      || /^\d{3}$/.test(s.slice(lastComma + 1));
    s = grouping ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  }

  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = `${s.slice(0, firstDot + 1)}${s.slice(firstDot + 1).replace(/\./g, '')}`;
  }
  return negative ? `-${s}` : s;
}

/** "1200000.5" → "1 200 000.5". Leaves a trailing '.' alone so typing "12." survives. */
export function formatAmount(raw) {
  const s = parseAmount(raw);
  if (s === '' || s === '-' || s === '.' || s === '-.') return s;
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  const [whole, ...rest] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  const decimals = rest.length ? `.${rest[0]}` : '';
  return `${negative ? '-' : ''}${grouped}${decimals}`;
}

/** Digits (and sign/point) before `pos`, so the caret can be put back after re-grouping. */
function significantBefore(text, pos) {
  return text.slice(0, pos).replace(/[^\d.-]/g, '').length;
}

function caretForSignificant(formatted, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/[\d.-]/.test(formatted[i])) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}

export default function AmountInput({
  value,
  onChange,
  className = '',
  wide = true,
  ...rest
}) {
  const ref = useRef(null);
  const caret = useRef(null);

  // Re-grouping changes the string length, so the browser's own caret restore lands in the
  // wrong place. Put it back after the same digit it was after before, before paint.
  useLayoutEffect(() => {
    if (caret.current == null || !ref.current) return;
    const pos = caret.current;
    caret.current = null;
    ref.current.setSelectionRange(pos, pos);
  });

  const handleChange = (event) => {
    const el = event.target;
    const typed = el.value;
    const raw = parseAmount(typed);
    const formatted = formatAmount(raw);
    caret.current = caretForSignificant(
      formatted,
      significantBefore(typed, el.selectionStart ?? typed.length),
    );
    // Hand the call site the unformatted value it already expects to store. Spreading the
    // DOM node would lose almost everything (its properties live on the prototype), and
    // spreading the synthetic event would drop preventDefault, so both are rebuilt by hand.
    onChange?.({
      ...event,
      target: { name: el.name, id: el.id, dataset: el.dataset, value: raw },
      currentTarget: { name: el.name, id: el.id, value: raw },
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    });
  };

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`amount-input${wide ? ' amount-input--wide' : ''}${className ? ` ${className}` : ''}`}
      value={formatAmount(value ?? '')}
      onChange={handleChange}
    />
  );
}
