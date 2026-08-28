/**
 * The hover box on "Foydalanuvchi bo'yicha o'rtacha dona".
 *
 * A stacked chart draws one series per salesman across every weekday, so Recharts names all of
 * them on hover — including everyone who sold nothing that day. With a dozen staff that is eleven
 * lines of "0" around the one number the reader came for.
 *
 * Rows are dropped from the hover only. The series themselves stay, which is what keeps a person
 * on the same colour in every bar and keeps the legend complete — hiding a *series* would have
 * reshuffled the palette from one weekday to the next.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { nonZeroTooltip } from './DashboardModern';

const STYLE = { background: '#fff' };

let container;
let root;

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
});

/** Renders whatever the tooltip returns and hands back its text, or null when it drew nothing. */
function show(props) {
  const node = nonZeroTooltip({ active: true, label: 'Dushanba', ...props }, STYLE);
  if (node === null) return null;
  act(() => root.render(node));
  return container.textContent;
}

const entry = (name, value) => ({ name, value, dataKey: name, color: '#123456' });

describe('who appears in the hover', () => {
  test('a salesman who sold nothing that day is left out', () => {
    const text = show({ payload: [entry('Ali', 3), entry('Vali', 0), entry('Hasan', 1.5)] });

    expect(text).toContain('Ali');
    expect(text).toContain('Hasan');
    expect(text).not.toContain('Vali');
  });

  test('the weekday itself is still named', () => {
    expect(show({ payload: [entry('Ali', 3)] })).toContain('Dushanba');
  });

  test('a fractional average is kept, not rounded away as a zero', () => {
    // These are averages, so a real figure can be well under one. Dropping anything "small"
    // rather than exactly zero would erase the quiet sellers this chart exists to show.
    const text = show({ payload: [entry('Ali', 0.25), entry('Vali', 0)] });

    expect(text).toContain('Ali');
    expect(text).toContain('0.25');
    expect(text).not.toContain('Vali');
  });

  test('a long average is trimmed to two decimals', () => {
    expect(show({ payload: [entry('Ali', 1.6666666)] })).toContain('1.67');
  });
});

describe('when there is nothing to show', () => {
  test('a weekday where nobody sold draws no box at all', () => {
    // An empty bordered box hanging off the cursor reads as a glitch.
    expect(show({ payload: [entry('Ali', 0), entry('Vali', 0)] })).toBeNull();
  });

  test('and neither does a hover that is not active', () => {
    expect(nonZeroTooltip({ active: false, payload: [entry('Ali', 3)] }, STYLE)).toBeNull();
  });

  test('nor one with no series behind it', () => {
    expect(nonZeroTooltip({ active: true, payload: [] }, STYLE)).toBeNull();
  });
});
