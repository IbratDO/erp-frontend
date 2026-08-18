import React from 'react';
import { useTranslation } from 'react-i18next';

import useBusy from '../utils/useBusy';

/**
 * A button that says so while its work is still going.
 *
 * A drop-in replacement for `<button>` on anything that writes: it keeps every class, style and
 * attribute it is given, so a row of buttons looks exactly as it did. The difference is that
 * once pressed it disables itself and reports until the handler's promise settles.
 *
 * That only works if the handler returns a promise, which means `onClick` must be the async
 * function itself — `onClick={() => handlePay(id)}` where `handlePay` is async, not a wrapper
 * that fires and forgets. A handler that returns nothing simply flickers, which is harmless but
 * pointless; those buttons are better left as plain `<button>`.
 *
 * Buttons that only open a form are deliberately not worth converting. Nothing is written until
 * the form is submitted, so a double-click there costs nothing — it is the submit button inside
 * that needs the guard.
 */
export default function ActionButton({
  onClick,
  children,
  disabled,
  busyLabel,
  ...rest
}) {
  const { t } = useTranslation();
  const [busy, run] = useBusy();

  const handleClick = (event) => {
    if (!onClick) return undefined;
    return run(() => onClick(event));
  };

  return (
    <button
      {...rest}
      disabled={disabled || busy}
      onClick={handleClick}
      aria-busy={busy || undefined}
    >
      {busy ? busyLabel ?? t('actions.loading', { ns: 'common' }) : children}
    </button>
  );
}
