/**
 * The dropdown panel's geometry.
 *
 * Worth pinning because the thing it fixes is invisible on the machine it is written on: a desktop
 * browser never reaches the mobile branch, so every one of these cases would otherwise be checked
 * only by someone holding a phone.
 *
 * The cases chosen are the ones that decide whether the owner's instruction was actually carried
 * out — opens upward on a phone, never runs off either edge, and desktop is left alone.
 */
import dropdownPanelPosition, { DROPDOWN_MOBILE_MAX_WIDTH } from './dropdownPanelPosition';

const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1440, h: 900 };

function withViewport({ w, h }, fn) {
  const realW = window.innerWidth;
  const realH = window.innerHeight;
  window.innerWidth = w;
  window.innerHeight = h;
  try {
    return fn();
  } finally {
    window.innerWidth = realW;
    window.innerHeight = realH;
  }
}

/** A trigger `height` tall whose top edge is `top` from the top of the screen. */
function rect({ top, left = 20, width = 200, height = 36 }) {
  return { top, left, width, height, bottom: top + height, right: left + width };
}

describe('on a phone', () => {
  it('opens upward: the panel is pinned by its bottom edge, not its top', () => {
    // The reported case -- a product row halfway down the screen.
    const pos = withViewport(PHONE, () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }));
    expect(pos.top).toBeUndefined();
    // 844 - 500 + 4: the panel's bottom sits 4px above the trigger's top edge.
    expect(pos.bottom).toBe(348);
  });

  it('is never taller than the room above it', () => {
    // 200px of screen above the trigger, so the 340px cap must not win.
    const pos = withViewport(PHONE, () => dropdownPanelPosition(rect({ top: 212 }), { gap: 4, maxHeight: 340 }));
    // 212 - 4 gap - 8 edge = 200.
    expect(pos.maxHeight).toBe(200);
  });

  it('still respects its own cap when there is more room than it needs', () => {
    const pos = withViewport(PHONE, () => dropdownPanelPosition(rect({ top: 700 }), { gap: 4, maxHeight: 340 }));
    expect(pos.maxHeight).toBe(340);
  });

  it('falls back to opening downward for a field at the very top of the screen', () => {
    // **The case the owner was warned about when choosing always-up.** Opening upward here would
    // give a panel ~50px tall, which is worse than the bug. A floor, not a preference.
    const pos = withViewport(PHONE, () => dropdownPanelPosition(rect({ top: 60 }), { gap: 4 }));
    expect(pos.bottom).toBeUndefined();
    expect(pos.top).toBe(100);
  });

  it('treats exactly the breakpoint width as a phone', () => {
    const pos = withViewport(
      { w: DROPDOWN_MOBILE_MAX_WIDTH, h: 800 },
      () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }),
    );
    expect(pos.top).toBeUndefined();
  });

  it('keeps a wide panel inside the left and right edges', () => {
    // A 280px floor on a 390px screen, from a trigger near the right edge.
    const pos = withViewport(PHONE, () => dropdownPanelPosition(
      rect({ top: 500, left: 300, width: 80 }),
      { minWidth: 280 },
    ));
    expect(pos.width).toBe(280);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + pos.width).toBeLessThanOrEqual(PHONE.w - 8);
  });
});

describe('on a desktop', () => {
  it('is unchanged: still opens downward from the trigger', () => {
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }));
    expect(pos.bottom).toBeUndefined();
    expect(pos.top).toBe(540);
  });

  it('keeps the viewport-based max height it always had', () => {
    // Deliberately not clamped to the room below -- that would shorten panels near the bottom of a
    // desktop window, which is a different change than the one asked for.
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 820 }), { maxHeight: 300 }));
    expect(pos.maxHeight).toBe('min(300px, calc(100vh - 96px))');
  });

  it('opens downward even low on the screen, where a phone would have flipped', () => {
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 850 }), { gap: 4 }));
    expect(pos.top).toBe(890);
  });
});

describe('the per-picker differences the six components rely on', () => {
  it('honours the 2px gap the Form pickers use, not only the 4px one', () => {
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 100 }), { gap: 2 }));
    expect(pos.top).toBe(138);
  });

  it('honours a 280px floor and a 200px floor separately', () => {
    const wide = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 100, width: 50 }), { minWidth: 280 }));
    const narrow = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 100, width: 50 }), { minWidth: 200 }));
    expect(wide.width).toBe(280);
    expect(narrow.width).toBe(200);
  });

  it('never shrinks a trigger that is already wider than the floor', () => {
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 100, width: 420 }), { minWidth: 200 }));
    expect(pos.width).toBe(420);
  });
});
