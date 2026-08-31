/**
 * The keyboard-wedge scan hook.
 *
 * Two properties carry the whole feature and both are invisible when they work: a scan is
 * recognised regardless of how the scanner was configured, and a *person* typing is never
 * interfered with. The second is the one worth most of these tests — a hook that occasionally
 * swallows a character out of someone's typing is worse than no hook at all.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import useBarcodeScanner from './useBarcodeScanner';

let container;
let root;
let scans;

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = false; });

beforeEach(() => {
  jest.useFakeTimers();
  scans = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

function Harness(props) {
  useBarcodeScanner({ onScan: (code) => scans.push(code), ...props });
  return null;
}

function mount(props = {}) {
  act(() => root.render(<Harness {...props} />));
}

/** Type one character as the physical key it came from, the way a wedge does. */
function press(char, { key = char, code = codeFor(char) } = {}) {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  act(() => { document.dispatchEvent(event); });
  return event;
}

function codeFor(char) {
  if (/[A-Za-z]/.test(char)) return `Key${char.toUpperCase()}`;
  if (/[0-9]/.test(char)) return `Digit${char}`;
  return '';
}

/** A whole scan, `gapMs` between characters. 10ms is wedge speed; 200ms is a person. */
function scan(text, gapMs = 10) {
  text.split('').forEach((char) => {
    act(() => { jest.advanceTimersByTime(gapMs); });
    press(char);
  });
}

describe('recognising a scan', () => {
  it('fires after the burst stops when the scanner sends no suffix', () => {
    mount();
    scan('LD00004821');
    expect(scans).toEqual([]); // nothing yet — the hook is still waiting for more characters
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual(['LD00004821']);
  });

  it('fires immediately on the Enter a CR-suffixed scanner sends', () => {
    mount();
    scan('LD00004821');
    const enter = press('Enter', { key: 'Enter', code: 'Enter' });
    expect(scans).toEqual(['LD00004821']);
    // The picker sits inside a form; an un-swallowed Enter would submit the sale.
    expect(enter.defaultPrevented).toBe(true);
  });

  it('fires on the Tab a TAB-suffixed scanner sends', () => {
    mount();
    scan('LD00004821');
    press('Tab', { key: 'Tab', code: 'Tab' });
    expect(scans).toEqual(['LD00004821']);
  });

  it('reads the physical key, so a Cyrillic layout still yields LD', () => {
    // On a Cyrillic layout `event.key` for the L key is 'д'. Reading `event.code` sidesteps it.
    mount();
    press('L', { key: 'д', code: 'KeyL' });
    press('D', { key: 'в', code: 'KeyD' });
    '00004821'.split('').forEach((c) => press(c));
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual(['LD00004821']);
  });
});

describe('staying out of the way', () => {
  it('ignores keys typed at human speed', () => {
    mount();
    scan('LD00004821', 200);
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual([]);
  });

  it('ignores a burst too short to be a code', () => {
    mount();
    scan('LD12');
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual([]);
  });

  it('leaves an Enter alone when no scan is in progress', () => {
    mount();
    const enter = press('Enter', { key: 'Enter', code: 'Enter' });
    expect(enter.defaultPrevented).toBe(false);
    expect(scans).toEqual([]);
  });

  it('captures nothing while the caret is in a text field', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    mount();
    scan('LD00004821');
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual([]);
    input.remove();
  });

  it('does capture in a field that opts in with data-scan-ok', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-scan-ok', '');
    document.body.appendChild(input);
    input.focus();
    mount();
    scan('LD00004821');
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual(['LD00004821']);
    input.remove();
  });

  it('ignores keyboard shortcuts', () => {
    mount();
    'LD00004821'.split('').forEach((char) => {
      const event = new KeyboardEvent('keydown', {
        key: char, code: codeFor(char), ctrlKey: true, bubbles: true, cancelable: true,
      });
      act(() => { document.dispatchEvent(event); });
    });
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('subscribes nothing while disabled', () => {
    mount({ enabled: false });
    scan('LD00004821');
    press('Enter', { key: 'Enter', code: 'Enter' });
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual([]);
  });

  it('stops listening and drops its pending flush on unmount', () => {
    mount();
    scan('LD00004821');
    act(() => root.unmount());
    act(() => { jest.advanceTimersByTime(500); });
    expect(scans).toEqual([]);
    // Re-created in afterEach's unmount, which must not throw on an already-unmounted root.
    root = createRoot(container);
  });

  it('keeps working across a re-render with a fresh inline callback', () => {
    // The callback lives in a ref precisely so the listener is not torn down mid-burst.
    mount();
    scan('LD0000', 10);
    mount({ minLength: 6 });
    '4821'.split('').forEach((c) => press(c));
    act(() => { jest.advanceTimersByTime(150); });
    expect(scans).toEqual(['LD00004821']);
  });
});
