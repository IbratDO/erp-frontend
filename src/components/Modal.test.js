/**
 * The window in front of the page.
 *
 * What is worth pinning is the behaviour a reader only notices when it is missing: Esc and the
 * close button getting them out, the page behind not scrolling under the overlay, focus landing
 * in the dialog and going back where it came from, and — the one that caused a real complaint
 * elsewhere — a drag that starts inside the form and releases on the dark area NOT closing it
 * and throwing the typing away.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Modal, { WIDE } from './Modal';

let container;
let root;

// Same as BusyForm.test.js: without it React warns on every act() in a concurrent root.
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = '';
});

function render(props = {}) {
  act(() => {
    root.render(
      <Modal open title="Mahsulot qo'shish" onClose={() => {}} {...props}>
        <input data-testid="first" />
        <button type="submit">Yaratish</button>
      </Modal>,
    );
  });
}

const dialog = () => document.querySelector('.modal__dialog');
const overlay = () => document.querySelector('.modal-overlay');

describe('showing and hiding', () => {
  test('renders nothing at all when closed', () => {
    render({ open: false });
    expect(overlay()).toBeNull();
  });

  test('renders onto document.body, not inside the page tree', () => {
    render();
    expect(overlay()).not.toBeNull();
    // The portal is what stops an ancestor's overflow or stacking context clipping the dialog.
    expect(container.contains(overlay())).toBe(false);
  });

  test('shows its title and its children', () => {
    render();
    expect(dialog().textContent).toContain("Mahsulot qo'shish");
    expect(dialog().querySelector('[data-testid="first"]')).not.toBeNull();
  });
});

describe('ways out', () => {
  test('the close button closes it', () => {
    const onClose = jest.fn();
    render({ onClose });
    act(() => {
      document.querySelector('.modal__close').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Esc closes it', () => {
    const onClose = jest.fn();
    render({ onClose });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the dark area closes it when that is allowed', () => {
    const onClose = jest.fn();
    render({ onClose, closeOnBackdrop: true });
    act(() => {
      overlay().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the dark area does not close it when the form holds real typing', () => {
    const onClose = jest.fn();
    render({ onClose, closeOnBackdrop: false });
    act(() => {
      overlay().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a press that lands inside the dialog never closes it', () => {
    const onClose = jest.fn();
    render({ onClose, closeOnBackdrop: true });
    act(() => {
      // Bubbles up to the overlay's handler, but started on the form — selecting text by
      // dragging must not throw the form away.
      dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('no listeners are left behind once it closes', () => {
    const onClose = jest.fn();
    render({ onClose });
    act(() => { root.render(<Modal open={false} onClose={onClose} />); });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the page behind', () => {
  test('cannot scroll while the dialog is open', () => {
    render();
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('scrolls again once it closes', () => {
    render();
    act(() => { root.render(<Modal open={false} onClose={() => {}} />); });
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  test('whatever the page had set is put back, not blanked', () => {
    document.body.style.overflow = 'scroll';
    render();
    expect(document.body.style.overflow).toBe('hidden');
    act(() => { root.render(<Modal open={false} onClose={() => {}} />); });
    expect(document.body.style.overflow).toBe('scroll');
  });
});

describe('focus', () => {
  test('moves into the dialog on open', () => {
    render();
    expect(document.activeElement).toBe(dialog().querySelector('[data-testid="first"]'));
  });

  test('goes back to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    render();
    expect(document.activeElement).not.toBe(opener);

    act(() => { root.render(<Modal open={false} onClose={() => {}} />); });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('accessibility', () => {
  test('announces itself as a dialog and names itself by its title', () => {
    render();
    expect(dialog().getAttribute('role')).toBe('dialog');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog().getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy).textContent).toBe("Mahsulot qo'shish");
  });

  test('the close button carries a label, not just a symbol', () => {
    render({ closeLabel: 'Yopish' });
    expect(document.querySelector('.modal__close').getAttribute('aria-label')).toBe('Yopish');
  });

  test('with no title it does not point aria-labelledby at nothing', () => {
    render({ title: undefined });
    expect(dialog().getAttribute('aria-labelledby')).toBeNull();
  });
});

describe('sizing and variants', () => {
  test('defaults wide enough for a three-column form, and never wider than the screen', () => {
    render();
    expect(dialog().style.maxWidth).toBe('1200px');
    // The cap is a cap, not a fixed size: on a narrower screen the dialog shrinks to fit
    // rather than making the reader scroll sideways to find its edge.
    expect(dialog().style.width).toBe('100%');
  });

  test('WIDE is what the line-item tables need to avoid scrolling sideways', () => {
    // `.batch-sale-lines` will not go below 58rem (928px); the dialog has to clear that plus
    // its own padding, or Inventory, Orders and Sales all scroll inside the window.
    expect(WIDE).toBeGreaterThan(928 + 40);
    render({ width: WIDE });
    expect(dialog().style.maxWidth).toBe(`${WIDE}px`);
  });

  test('a destructive form keeps the red edge it has everywhere else', () => {
    render({ className: 'form-card--danger' });
    expect(dialog().classList.contains('form-card--danger')).toBe(true);
    // Still a form card, so the variant styles it rather than replacing it.
    expect(dialog().classList.contains('form-card')).toBe(true);
  });

  test('no className leaves no stray whitespace class', () => {
    render();
    expect(dialog().className).toBe('modal__dialog form-card');
  });
});

/**
 * The trap that took the Qarzdorlik page down after the form-window conversion.
 *
 * `open={false}` makes Modal render nothing — but React builds the children *before* Modal is
 * ever called, so a body that reads `collectTarget.customer_name` throws while the page is
 * merely sitting there with nothing selected. Replacing `{target && (<div>…</div>)}` with
 * `<Modal open={!!target}>…</Modal>` therefore looks equivalent and is not.
 *
 * `open` decides what is *shown*. Only a guard around the element decides what is *built*.
 */
describe('children are built even while closed', () => {
  test('a closed Modal still evaluates its children', () => {
    const built = jest.fn();
    const Child = () => { built(); return <span>x</span>; };
    act(() => {
      root.render(<Modal open={false} onClose={() => {}}>{Child()}</Modal>);
    });
    expect(document.querySelector('.modal__dialog')).toBeNull();
    // Nothing on screen, yet the body ran. This is the whole hazard in one assertion.
    expect(built).toHaveBeenCalled();
  });

  test('so a body that reads a missing target throws despite open={false}', () => {
    const target = null;
    expect(() => {
      act(() => {
        root.render(
          <Modal open={false} onClose={() => {}}>
            <span>{target.customer_name}</span>
          </Modal>,
        );
      });
    }).toThrow(/customer_name/);
  });

  test('guarding the element instead is what actually keeps the body from running', () => {
    const target = null;
    expect(() => {
      act(() => {
        root.render(
          <div>{target && (
            <Modal open onClose={() => {}}>
              <span>{target.customer_name}</span>
            </Modal>
          )}</div>,
        );
      });
    }).not.toThrow();
  });
});
