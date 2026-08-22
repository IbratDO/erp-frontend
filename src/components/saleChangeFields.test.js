/**
 * The suggested Qaytim has to describe the numbers currently on the screen.
 *
 * It used to be worked out once, when the box was ticked, and then never again. $1,000 handed
 * over for a $950 item suggested $50 correctly — but correcting the amount to $1,500 left the
 * suggestion sitting at $50, and the panel then announced that the shop was keeping the missing
 * $500 and asked for it to be booked as profit. The number was stale; the accusation was not.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import SaleChangeFields from './SaleChangeFields';

// Only `useTranslation` is replaced. `initReactI18next` has to survive, because the currency
// formatter this component imports boots the real i18n module on the way in.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key) => key }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** Drive the panel the way a real form does: it owns the state, the panel edits it. */
function mount({ required, currency = 'USD', startTicked = true }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = { form: { apply_change: startTicked, change_uzs: '', change_usd: '' } };

  const render = (req) => {
    act(() => {
      root.render(
        <SaleChangeFields
          form={state.form}
          setForm={(fn) => {
            state.form = typeof fn === 'function' ? fn(state.form) : fn;
            render(state.currentRequired);
          }}
          sc={currency}
          required={req}
          cbuRate={12000}
          t={(key) => key}
        />,
      );
    });
  };

  return {
    state,
    /** What the parent form does when the courier corrects the amount collected. */
    setRequired(req) {
      state.currentRequired = req;
      render(req);
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the suggested change follows the amount collected', () => {
  test('$1000 for a $950 item suggests $50', () => {
    const panel = mount({ required: 50 });
    panel.setRequired(50);
    expect(panel.state.form.change_usd).toBe('50.00');
    expect(panel.state.form.change_uzs).toBe('');
    panel.unmount();
  });

  test('correcting $1000 to $1500 re-suggests $550, not the stale $50', () => {
    const panel = mount({ required: 50 });
    panel.setRequired(50);
    expect(panel.state.form.change_usd).toBe('50.00');

    panel.setRequired(550);
    expect(panel.state.form.change_usd).toBe('550.00');
    panel.unmount();
  });

  test('a som sale suggests whole som', () => {
    const panel = mount({ required: 60000, currency: 'UZS' });
    panel.setRequired(60000);
    expect(panel.state.form.change_uzs).toBe('60000');
    expect(panel.state.form.change_usd).toBe('');

    panel.setRequired(85000);
    expect(panel.state.form.change_uzs).toBe('85000');
    panel.unmount();
  });

  test('nothing is suggested while the box is unticked', () => {
    const panel = mount({ required: 50, startTicked: false });
    panel.setRequired(50);
    expect(panel.state.form.change_usd).toBe('');
    panel.unmount();
  });

  test('a surplus that goes away clears the suggestion instead of leaving it standing', () => {
    const panel = mount({ required: 50 });
    panel.setRequired(50);
    expect(panel.state.form.change_usd).toBe('50.00');

    // The courier corrects the collection down to the exact price: nothing is owed back.
    panel.setRequired(0);
    expect(panel.state.form.change_usd).toBe('');
    expect(panel.state.form.change_uzs).toBe('');
    panel.unmount();
  });

  test('an unchanged amount does not rewrite the field on every keystroke elsewhere', () => {
    const panel = mount({ required: 50 });
    panel.setRequired(50);
    // A hand correction the courier makes: give $45 back and let the shop keep $5.
    act(() => {
      panel.state.form = { ...panel.state.form, change_usd: '45' };
    });
    // Something unrelated re-renders the form; the surplus has not moved.
    panel.setRequired(50);
    expect(panel.state.form.change_usd).toBe('45');
    panel.unmount();
  });
});
