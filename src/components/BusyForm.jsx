import React, { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import useBusy from '../utils/useBusy';

const BusyContext = createContext(false);

/**
 * A form that holds its submit button down until the submission has actually finished.
 *
 * Converting a form is two token changes — `<form>` becomes `<BusyForm>` and its
 * `<button type="submit">` becomes `<SubmitButton>` — with no state to wire up in the page.
 * That matters at this scale: the alternative is a `submitting` flag threaded through every
 * form by hand, which is where one gets forgotten.
 *
 * The submit handler must return its promise for this to mean anything. Most already do, being
 * `async`; one that is not simply flickers, which is harmless.
 *
 * `preventDefault` stays the handler's own business, exactly as it is today, so nothing about
 * an existing form changes except when its button comes back.
 */
export function BusyForm({ onSubmit, children, ...rest }) {
  const [busy, run] = useBusy();

  const handleSubmit = (event) => {
    if (!onSubmit) return undefined;
    if (busy) {
      // A second Enter or a click that beat the disable: the first is still running.
      event.preventDefault();
      return undefined;
    }
    return run(() => onSubmit(event));
  };

  return (
    <BusyContext.Provider value={busy}>
      <form {...rest} onSubmit={handleSubmit}>
        {children}
      </form>
    </BusyContext.Provider>
  );
}

/**
 * The submit button of a `BusyForm`. Disables itself and reports while the form is submitting.
 *
 * Outside a `BusyForm` it is an ordinary button, so half-converting a page cannot break it.
 */
export function SubmitButton({ children, disabled, busyLabel, ...rest }) {
  const { t } = useTranslation();
  const busy = useContext(BusyContext);

  return (
    <button
      type="submit"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? busyLabel ?? t('actions.loading', { ns: 'common' }) : children}
    </button>
  );
}

export default BusyForm;
