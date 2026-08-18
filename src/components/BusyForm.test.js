/**
 * The form half of the double-click guard.
 *
 * `useBusy` is tested on its own; what this covers is the part specific to a form — that a
 * submit which is refused still gets prevented. That case is easy to get wrong and expensive
 * when it is: `run` declines the second submit on its ref without calling the handler, so the
 * handler's own `preventDefault` never fires, and an unprevented submit is a real page
 * navigation. The user came here to avoid creating one extra sale; reloading the tab mid-write
 * is not the trade we want.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import BusyForm, { SubmitButton } from './BusyForm';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('BusyForm', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(onSubmit) {
    act(() => {
      root.render(
        <BusyForm onSubmit={onSubmit}>
          <SubmitButton className="btn-primary">Yaratish</SubmitButton>
        </BusyForm>,
      );
    });
    return {
      form: container.querySelector('form'),
      button: () => container.querySelector('button'),
    };
  }

  /** Submit the form the way a click does, and report whether the default was prevented. */
  function submit(form) {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  test('the first submit runs and the button reports', async () => {
    const gate = deferred();
    const calls = [];
    const view = render(() => {
      calls.push('ran');
      return gate.promise;
    });

    expect(submit(view.form)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(view.button().disabled).toBe(true);
    expect(view.button().textContent).toBe('actions.loading');

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(view.button().disabled).toBe(false);
    expect(view.button().textContent).toBe('Yaratish');
  });

  test('a second submit in the same tick neither runs nor navigates', async () => {
    const gate = deferred();
    const calls = [];
    const view = render(() => {
      calls.push('ran');
      return gate.promise;
    });

    // Both dispatched inside one `act`, so React does not re-render between them and `busy`
    // still reads false on the second — the ref inside `run` is the only thing that knows.
    // Wrapping each submit in its own `act` would let the re-render land first and quietly
    // test the easy case instead. This is the create-a-sale double click as reported.
    const events = [];
    act(() => {
      for (let i = 0; i < 2; i += 1) {
        const event = new Event('submit', { bubbles: true, cancelable: true });
        events.push(event);
        view.form.dispatchEvent(event);
      }
    });

    expect(calls).toHaveLength(1);
    expect(events.map((e) => e.defaultPrevented)).toEqual([true, true]);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
  });

  test('the guard holds across a slow step before the request is even sent', async () => {
    // Sales.js re-downloads inventory before it posts, so the window where nothing has been
    // sent yet is a second or more. The guard has to be closed for that whole window, not just
    // while a request is in the air.
    const slow = deferred();
    const posts = [];
    const view = render(async () => {
      await slow.promise;
      posts.push('post');
    });

    submit(view.form);
    submit(view.form);
    submit(view.form);
    expect(posts).toHaveLength(0);

    await act(async () => {
      slow.resolve();
      await slow.promise;
    });
    expect(posts).toHaveLength(1);
  });

  // Releasing the button after a rejected submit is `useBusy`'s job and is covered there
  // ("a failure releases the button"). Asserting it again through a real submit event only
  // proves the same `finally`, and it cannot do so cleanly: React drops the promise a DOM
  // handler returns, so the rejection escapes as an unhandled one no test can catch.

  test('a form with no handler still does not navigate', () => {
    act(() => {
      root.render(
        <BusyForm>
          <SubmitButton>Yaratish</SubmitButton>
        </BusyForm>,
      );
    });
    expect(submit(container.querySelector('form'))).toBe(true);
  });
});
