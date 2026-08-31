/**
 * Print a self-contained HTML document from a hidden iframe.
 *
 * Not `window.print()` on the page itself, and the reason is specific: `Modal` sets
 * `document.body.style.overflow = 'hidden'` while it is open, and browsers have long clipped print
 * output to the first page when the body is `overflow:hidden`. Printing a sheet of forty labels
 * from inside a modal would yield one. Unsetting the overflow at print time would fight the
 * modal's own effect, so the document is printed somewhere the page's styles cannot reach it.
 *
 * That isolation is worth having anyway: the app's stylesheet, the overlay's `position:fixed` and
 * any future `@page` rule elsewhere all stay out of the label.
 */
export default function printHtmlDocument(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'print');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';

  // An iframe fires `load` twice: once for the `about:blank` it gets on being appended, and again
  // for the document written into it below. Without this guard both fired a print, and the
  // operator had to dismiss two dialogs for every sheet — cancelling one only revealed the next.
  let printed = false;

  frame.onload = () => {
    if (printed) return;
    printed = true;
    // One frame of grace: the barcode SVG has to lay out before the snapshot is taken, and
    // printing synchronously here can catch the document mid-layout with blank labels.
    requestAnimationFrame(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } finally {
        // The print dialog is modal, so this only runs once the operator has dismissed it.
        setTimeout(() => frame.remove(), 1000);
      }
    });
  };

  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
}
