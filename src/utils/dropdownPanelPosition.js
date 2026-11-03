/**
 * Where a dropdown panel goes, for the six pickers that open one.
 *
 * **On a phone or tablet the panel opens upward; on a desktop it opens downward, as before.**
 *
 * The reason is the Mahsulot picker in the Sotuvlar batch form, but the fault was never specific
 * to it. Every one of these panels is `position: fixed` and anchored at `trigger.bottom + gap`,
 * with a max height that asks only how tall the *window* is — never how much room is actually left
 * below the trigger. On a desktop that is harmless, because a form field is rarely within 340px of
 * the bottom of a 900px window. On a phone it is the normal case: tap a product row halfway down a
 * 650px screen and the panel is told it may be 340px tall starting at y≈400, so a third of the list
 * is simply off the bottom of the glass, and the page behind it scrolls instead.
 *
 * **A tablet has the same fault, and the owner reported it after the phone fix shipped.** The reason
 * it is not a desktop is height, not width: an iPad in landscape is 1024 wide but only 768 tall, so
 * a field two thirds of the way down the page is as badly off as on a phone. Width is what this
 * function can actually measure at the moment a panel opens, and below 1024 every device is one of
 * the two shapes that suffer — so the tier is a width even though the cause is a height.
 *
 * Opening upward is the owner's call, taken over auto-flipping by whichever side has more room.
 * Auto-flip is the more usual answer and it was offered; always-up was chosen because it is
 * predictable — the list appears in the same place relative to your thumb every time, which matters
 * more at a counter than squeezing out the last few rows.
 *
 * **The one case where it still opens down** is a trigger with less than
 * `MIN_USABLE_HEIGHT` above it — a field at the very top of the screen. That is not auto-flip
 * creeping back in: upward there would mean a panel two rows tall, which is worse than the problem
 * being fixed. It is a floor, not a preference.
 *
 * **Whichever way it opens, the panel is clamped to the room it opens into.** This was the piece
 * missing from the first two attempts: the direction was fixed but the height was still taken from
 * the window, so a downward panel — on a desktop, or on a tablet whose field sat too near the top
 * to flip — could still be told it had 340px when the screen had 120. A `position: fixed` panel
 * that overruns the edge cannot be scrolled to, because the page behind it is what scrolls, so
 * those rows are unreachable rather than merely below the fold. Clamping is what actually makes the
 * list complete; the direction only decides whether it is cramped or roomy.
 *
 * Anchoring upward uses `bottom`, not a computed `top`, deliberately — the panel's own height is
 * not known until it has rendered, and it changes as the search box filters the list. Pinning the
 * bottom edge above the trigger lets it grow and shrink from there without a second measure pass.
 */

/**
 * Widest screen that opens its dropdowns upward: phone and tablet, not desktop.
 *
 * 1024 because that is an iPad in landscape — the widest of the shapes that suffer — and because
 * it stays below the window widths a laptop browser is actually opened at. It is deliberately not
 * one of the stylesheet's breakpoints: those describe where a *layout* changes, and none of them
 * happens to mean "phone or tablet". Changing this one number moves the whole behaviour.
 */
export const DROPDOWN_FLIP_UP_MAX_WIDTH = 1024;

/** Breathing room kept between the panel and the edge of the screen. */
const EDGE_GAP = 8;

/**
 * Below this, opening upward is not worth doing — roughly two rows plus the search box. A field
 * this close to the top of the screen opens downward instead, where there is a whole screen free.
 * It is a floor, not a preference: it asks only whether upward is usable, never which side is
 * roomier, which is what keeps this from quietly becoming the auto-flip that was turned down.
 */
const MIN_USABLE_HEIGHT = 160;

/**
 * @param rect     the trigger's `getBoundingClientRect()`
 * @param minWidth the panel's floor width — 280 for the pickers with long product labels, 200 for
 *                 the rest. Kept a parameter because that difference is deliberate.
 * @param gap      distance between trigger and panel — 4 for the Filter/Product/Customer pickers,
 *                 2 for the Form ones. Likewise deliberate.
 * @param maxHeight the panel's tallest, in px — 340 or 300 depending on the picker.
 * @returns `{ top | bottom, left, width, maxHeight }`, to spread into the panel's style. Exactly
 *          one of `top` and `bottom` is a number; the other is `undefined`, which React omits.
 */
export default function dropdownPanelPosition(rect, { minWidth = 200, gap = 4, maxHeight = 340 } = {}) {
  // The no-window fallback is a desktop width on purpose. It used to be 1024, which was harmless
  // while the tier was 600 and would now be the opposite of harmless: 1024 is exactly the tier, so
  // a render with no `window` would flip upward -- the one direction it cannot verify there is room
  // for. Without a window there is no screen to run off, and downward is the older behaviour.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  const w = Math.max(rect.width, minWidth);
  const width = Math.min(w, vw - 16);
  const left = Math.min(Math.max(EDGE_GAP, rect.left), vw - width - EDGE_GAP);

  const roomAbove = rect.top - gap - EDGE_GAP;
  const roomBelow = vh - rect.bottom - gap - EDGE_GAP;

  // Which way it opens. The preference is upward on a phone or tablet, downward on a desktop; the
  // second half of each test is the floor described above, and it now guards **both** directions.
  // It used to guard only the upward one, which is how a downward panel could still be told it may
  // be 340px tall with 120px of screen left under it.
  const openUp = vw <= DROPDOWN_FLIP_UP_MAX_WIDTH
    ? roomAbove >= MIN_USABLE_HEIGHT || roomAbove >= roomBelow
    : roomBelow < MIN_USABLE_HEIGHT && roomAbove > roomBelow;

  const room = openUp ? roomAbove : roomBelow;

  // **The panel is never taller than the space it opens into.** This is the whole fix, and it has
  // to be a measured number rather than the `min(340px, calc(100vh - 96px))` each picker used to
  // carry: that expression asks how tall the window is and never where the trigger sits, so a field
  // two thirds down the page was handed a panel that ran past the bottom edge. The list inside
  // scrolls, but the page does not scroll to reach it — the panel is `position: fixed` — so the
  // rows past the edge were simply unreachable. That is the bug as reported: "I cannot see the full
  // list although I scroll down."
  //
  // The floor stops a trigger that is itself scrolled half off the screen from producing a panel of
  // zero height, which would read as the picker being broken rather than cramped.
  const height = Math.max(96, Math.min(maxHeight, room));

  return openUp
    ? { top: undefined, bottom: vh - rect.top + gap, left, width, maxHeight: height }
    : { top: rect.bottom + gap, bottom: undefined, left, width, maxHeight: height };
}
