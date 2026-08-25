import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A form card lifted off the page into a window in front of it.
 *
 * Rendered through a portal onto `document.body` rather than in place. A dialog that stays
 * nested under the page inherits whatever its ancestors impose — a stacking context from a
 * transform, a clipped `overflow` — and then sits *behind* things or gets its edges cut off for
 * reasons that have nothing to do with the dialog. The portal is what makes it reliably a
 * window rather than a very tall card.
 *
 * **The overlay scrolls, not the dialog.** A long form is the normal case here, so the obvious
 * move is `max-height` and `overflow-y: auto` on the dialog itself. That would clip the
 * absolutely-positioned dropdowns some of these forms open — the colour and size pickers on
 * Mahsulotlar among them — at the point where the list is longest and most needed. Letting the
 * overlay do the scrolling leaves those dropdowns behaving exactly as they did on the page.
 *
 * `margin: auto` inside a flex overlay is the centring: it puts the dialog in the middle when
 * there is room and, unlike `align-items: center`, never takes a tall dialog's top edge out of
 * reach by pushing it above the scrollable area.
 */
/**
 * For dialogs built round the `batch-sale-lines` table — Inventory, Orders and Sales all lay
 * their lines out as one row per item. That table will not go below 58rem without scrolling, so
 * the ordinary width leaves it scrolling sideways inside the dialog on every screen.
 */
export const WIDE = 1400;

export default function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = 'Close',
  /**
   * Width of the dialog. The default suits a `form-grid` of ordinary fields; forms built round
   * the `batch-sale-lines` table pass `WIDE`, which is what stops that table — 58rem at its
   * narrowest — from having to scroll sideways inside the dialog.
   *
   * Always applied as `min(100%, …)`, so a width wider than the screen is not one that has to be
   * scrolled to; it simply becomes the screen.
   */
  width = 1200,
  /**
   * Whether clicking the dark area closes the dialog. Off for anything where a stray click
   * would lose typing that cannot be recovered.
   */
  closeOnBackdrop = true,
  /**
   * Extra classes for the dialog itself. `form-card--danger` is the one in use, and it is worth
   * keeping: the red edge is how a destructive form announces itself everywhere else in the app,
   * and a dialog that drops it looks like any other form right up until it runs.
   */
  className = '',
}) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);

  const handleClose = useCallback(() => {
    if (typeof onClose === 'function') onClose();
  }, [onClose]);

  // Esc closes, and Tab is kept inside the dialog. Without the trap, tabbing walks off into the
  // page behind — which is still there, still focusable, and now invisible behind the overlay.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, handleClose]);

  // The page behind must not scroll under the overlay — otherwise a scroll gesture over the
  // dark area moves the table instead of the form, and the reader loses their place on both.
  useEffect(() => {
    if (!open) return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previousOverflow; };
  }, [open]);

  // Focus moves in on open and back to whatever opened it on close, so keyboard and screen
  // reader users are not left where the dialog no longer is.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    const root = dialogRef.current;
    if (root) {
      // The first field, not the close button — which is first in the DOM because it sits in
      // the header, and would otherwise be what a keyboard user lands on when they asked to
      // add something. The X is a way out, never the opening move.
      const candidates = [...root.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]),'
        + ' button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.classList.contains('modal__close'));
      (candidates[0] || root).focus({ preventScroll: true });
    }
    return () => {
      const previous = previouslyFocused.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      // Only a click that lands on the dark area itself, never one that started inside the
      // dialog and drifted out — dragging to select text used to close the form.
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`modal__dialog form-card${className ? ` ${className}` : ''}`}
        // `width: 100%` capped by `max-width`, rather than `width: min(100%, Xpx)`. Same result
        // in a browser, but it is two long-supported properties instead of one CSS function, and
        // it is a value that can actually be read back and asserted on.
        style={{ width: '100%', maxWidth: `${width}px` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal__header">
          {title && <h2 id={titleId.current} className="modal__title">{title}</h2>}
          <button
            type="button"
            className="modal__close"
            onClick={handleClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
