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
import dropdownPanelPosition, { DROPDOWN_FLIP_UP_MAX_WIDTH } from './dropdownPanelPosition';

const PHONE = { w: 390, h: 844 };
/** iPad in landscape: wide, but only 768 tall, which is why it has the phone's problem. */
const TABLET_LANDSCAPE = { w: 1024, h: 768 };
const TABLET_PORTRAIT = { w: 768, h: 1024 };
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

describe('on a tablet', () => {
  // Added after the owner reported the phone fix had not helped on a tablet. An iPad in landscape
  // is wider than a laptop is tall, which is exactly why a width-only tier of 600 missed it.
  it('opens upward in landscape, where the screen is only 768 tall', () => {
    const pos = withViewport(TABLET_LANDSCAPE, () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }));
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(272);
  });

  it('opens upward in portrait too', () => {
    const pos = withViewport(TABLET_PORTRAIT, () => dropdownPanelPosition(rect({ top: 600 }), { gap: 4 }));
    expect(pos.top).toBeUndefined();
  });

  it('treats exactly 1024 as a tablet, and one pixel more as a desktop', () => {
    const at = withViewport({ w: DROPDOWN_FLIP_UP_MAX_WIDTH, h: 768 },
      () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }));
    const over = withViewport({ w: DROPDOWN_FLIP_UP_MAX_WIDTH + 1, h: 768 },
      () => dropdownPanelPosition(rect({ top: 500 }), { gap: 4 }));
    expect(at.top).toBeUndefined();
    expect(over.bottom).toBeUndefined();
  });
});

describe('with no window at all', () => {
  it('opens downward, rather than flipping on the fallback width', () => {
    // The fallback used to be 1024, which is now exactly the tier -- it would have flipped upward
    // in the one situation where there is no screen to measure room against.
    const realWindow = global.window;
    // eslint-disable-next-line no-global-assign
    delete global.window;
    try {
      const pos = dropdownPanelPosition(rect({ top: 500 }), { gap: 4 });
      expect(pos.bottom).toBeUndefined();
      expect(pos.top).toBe(540);
    } finally {
      global.window = realWindow;
    }
  });
});

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

  it('clamps that downward fallback too, rather than letting it run off the bottom', () => {
    // The gap between the first two fixes: direction was handled, height was not, so this branch
    // could still hand back a 340px panel on a short screen.
    const pos = withViewport({ w: 390, h: 420 }, () => dropdownPanelPosition(rect({ top: 60 }), { gap: 4, maxHeight: 340 }));
    expect(pos.top).toBe(100);
    // 420 - 96 - 4 - 8 = 312, not 340.
    expect(pos.maxHeight).toBe(312);
  });

  it('never returns a zero-height panel for a trigger scrolled off the bottom edge', () => {
    const pos = withViewport(PHONE, () => dropdownPanelPosition(rect({ top: 840 }), { gap: 4 }));
    expect(pos.maxHeight).toBeGreaterThanOrEqual(96);
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

  it('clamps a downward panel to the room below it, instead of to the window height', () => {
    // **The bug the owner hit on a tablet, reproduced at desktop size.** The old value here was the
    // literal string `min(300px, calc(100vh - 96px))`, which asks how tall the window is and never
    // where the trigger sits. 900 - 656 - 4 - 8 = 232.
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 620 }), { gap: 4, maxHeight: 300 }));
    expect(pos.top).toBe(660);
    expect(pos.maxHeight).toBe(232);
  });

  it('still prefers downward low on the screen, so long as downward is usable', () => {
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 660 }), { gap: 4 }));
    expect(pos.top).toBe(700);
    expect(pos.maxHeight).toBe(192);
  });

  it('flips up only when downward would be unusable', () => {
    // A field 40px from the bottom of a desktop window. Downward gives ~0 rows; the floor applies
    // in this direction too now, which it did not before.
    const pos = withViewport(DESKTOP, () => dropdownPanelPosition(rect({ top: 850 }), { gap: 4 }));
    expect(pos.top).toBeUndefined();
    // 838px free above, so the picker's own 340 cap is what limits it, not the screen.
    expect(pos.maxHeight).toBe(340);
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
