import { useEffect, useRef } from 'react';

/**
 * Listen for a keyboard-wedge barcode scanner.
 *
 * A Bluetooth scanner in HID mode *is* a keyboard: it types the code and usually presses Enter.
 * There is no device to open, no permission to request and no driver — the entire problem is
 * telling a scan apart from a person typing, and then staying out of the way the rest of the time.
 *
 * **How a scan is recognised.** Characters arriving less than `maxKeyGapMs` apart accumulate into
 * a buffer; a longer gap starts a new one. A wedge emits at 5–15ms per character and a fast human
 * sustains 60–120ms, so 50ms sits comfortably between the two and has never needed tuning per
 * device.
 *
 * **Both terminator styles.** Scanners can be configured to append CR, TAB, or nothing at all.
 * Enter and Tab flush immediately; for the no-suffix case a timer rearmed on every keystroke
 * flushes shortly after the burst stops. The timer is only safe because the flush hands the buffer
 * to `onScan`, which is free to reject it — a burst of fast typing is discarded there in silence
 * rather than beeping at the typist. That is what makes this hook non-invasive enough to leave
 * mounted.
 *
 * **It never takes keystrokes from a person.** If the focus is in a text field the hook does
 * nothing at all — a hard bail, not a heuristic, because a heuristic that is wrong once eats a
 * character out of someone's typing and they never trust the page again. The dedicated scan box
 * opts back in with `data-scan-ok`.
 *
 * **Layout independence.** The buffer is built from `event.code` (physical key identity) rather
 * than `event.key`, because on a Cyrillic layout the `L` key reports `д` and the `LD` prefix would
 * arrive mangled.
 */

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image',
]);

/** Is the caret somewhere a person could be typing? */
function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
}

/**
 * The character a key press means, independent of keyboard layout.
 *
 * `event.code` is the physical key, so `KeyL` is the L key whether the OS is set to Latin or
 * Cyrillic. Falling back to `event.key` covers keys `code` does not name usefully (and browsers
 * that leave it empty).
 */
function characterFor(event) {
  const code = event.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  const key = event.key || '';
  return key.length === 1 ? key : '';
}

export default function useBarcodeScanner({
  enabled = true,
  onScan,
  minLength = 6,
  maxKeyGapMs = 50,
  flushDelayMs = 90,
} = {}) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timerRef = useRef(null);

  // Held in a ref so callers can pass an inline arrow without resubscribing the listener on every
  // render. Rebuilding it mid-burst would drop the half of the code already buffered.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!enabled) return undefined;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    /** Hand the buffer over if it is long enough to be a code, and reset either way. */
    const flush = () => {
      clearTimer();
      const code = bufferRef.current;
      bufferRef.current = '';
      if (code.length >= minLength && typeof onScanRef.current === 'function') {
        onScanRef.current(code);
      }
    };

    const handler = (event) => {
      // A shortcut is not a scan. Scanners send bare keys.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Hands off entirely while someone might be typing.
      const target = document.activeElement;
      if (isTextEntry(target) && !target.hasAttribute('data-scan-ok')) return;

      const now = Date.now();

      if (event.key === 'Enter' || event.key === 'Tab') {
        // Only swallow the terminator when it really ends a scan. This modal's picker sits inside
        // a form, so a bare Enter would submit the sale — but suppressing an Enter that was *not*
        // part of a scan would break every keyboard user on the page.
        if (bufferRef.current.length >= minLength) {
          event.preventDefault();
          event.stopPropagation();
          flush();
        } else {
          bufferRef.current = '';
          clearTimer();
        }
        lastKeyTimeRef.current = now;
        return;
      }

      const char = characterFor(event);
      if (!char) return;

      // Too slow to be one burst — this is the start of a new one.
      if (now - lastKeyTimeRef.current > maxKeyGapMs) bufferRef.current = '';
      lastKeyTimeRef.current = now;
      bufferRef.current += char;

      // Never preventDefault a character key: the first characters of a burst are
      // indistinguishable from typing, so suppressing them is always a gamble. Landing
      // harmlessly on a button is not.
      clearTimer();
      timerRef.current = setTimeout(flush, flushDelayMs);
    };

    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      clearTimer();
      bufferRef.current = '';
    };
  }, [enabled, minLength, maxKeyGapMs, flushDelayMs]);
}
