/**
 * Printing a label sheet.
 *
 * The property worth pinning is embarrassingly simple and was wrong: **one click, one print
 * dialog**. An iframe appended with no `src` loads `about:blank` and fires `load`, and then the
 * `document.write` fires `load` a second time — so a handler attached to `onload` printed twice
 * and the operator had to dismiss two dialogs for every sheet.
 */
import printHtmlDocument from './printHtml';

let printCalls;
let originalRaf;

beforeEach(() => {
  printCalls = 0;
  // jsdom has no real print; count the calls instead. The property under test is how many.
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return {
        focus: () => {},
        print: () => { printCalls += 1; },
      };
    },
  });
  originalRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  window.requestAnimationFrame = originalRaf;
  delete window.HTMLIFrameElement.prototype.contentWindow;
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

const HTML = '<!DOCTYPE html><html><body><div class="label">x</div></body></html>';

/**
 * jsdom does not fire the iframe's own load events, so they are dispatched by hand — which is the
 * more honest test anyway: it reproduces the exact double-load a browser produces, and keeps
 * failing if the one-shot guard is removed, regardless of jsdom's timing quirks.
 */
function loadTwice() {
  const frame = document.querySelector('iframe');
  frame.dispatchEvent(new Event('load')); // about:blank
  frame.dispatchEvent(new Event('load')); // the written document
}

it('opens exactly one print dialog, though the frame loads twice', () => {
  printHtmlDocument(HTML);
  loadTwice();
  jest.runAllTimers();
  expect(printCalls).toBe(1);
});

it('opens none until the frame has loaded at all', () => {
  printHtmlDocument(HTML);
  jest.runAllTimers();
  expect(printCalls).toBe(0);
});

it('cleans the frame off the page afterwards', () => {
  printHtmlDocument(HTML);
  loadTwice();
  jest.runAllTimers();
  expect(document.querySelectorAll('iframe').length).toBe(0);
});
