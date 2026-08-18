/**
 * The visible half of the double-click guard.
 *
 * `api.js` refuses a duplicate request, but silently — the user is still looking at a button
 * that appears to have done nothing, which is what made them click again. This hook is what
 * makes the button say it is working, and what stops the second click before it becomes a
 * request at all.
 *
 * The case worth pinning is the one that looks impossible: two clicks inside a single tick.
 * React has not re-rendered between them, so a guard read from state would still say `false`
 * on the second. Only a ref is already true by then.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import useBusy from './useBusy';

// React 18 wants to be told it is under test, or every `act` logs a warning that buries the
// one assertion here that actually reads console.error. It is read when `act` runs, not when
// this module is evaluated, so setting it in `beforeAll` is what actually takes effect.
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** Render a component and hand back the latest value it published. */
function mount(Component) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Component />);
  });
  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
}

/** A deferred promise, so the test decides when the "request" finishes. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useBusy', () => {
  let harness;

  beforeEach(() => {
    harness = null;
  });

  afterEach(() => {
    if (harness) harness.unmount();
  });

  function setup() {
    const seen = { busy: null, run: null, calls: 0 };
    function Probe() {
      const [busy, run] = useBusy();
      seen.busy = busy;
      seen.run = run;
      return <span>{busy ? 'busy' : 'idle'}</span>;
    }
    harness = mount(Probe);
    return seen;
  }

  test('it reports while the action runs and stops when it settles', async () => {
    const seen = setup();
    const gate = deferred();

    let result;
    act(() => {
      result = seen.run(() => gate.promise);
    });
    expect(seen.busy).toBe(true);
    expect(harness.container.textContent).toBe('busy');

    await act(async () => {
      gate.resolve('done');
      await result;
    });
    expect(seen.busy).toBe(false);
    expect(harness.container.textContent).toBe('idle');
  });

  test('a second click in the same tick never starts', async () => {
    const seen = setup();
    const gate = deferred();
    let starts = 0;
    const action = () => {
      starts += 1;
      return gate.promise;
    };

    let first;
    let second;
    act(() => {
      // Both fired before React can re-render, which is exactly what an impatient
      // double-click looks like. A guard read from state would let the second through.
      first = seen.run(action);
      second = seen.run(action);
    });

    expect(starts).toBe(1);
    await act(async () => {
      gate.resolve();
      await first;
    });
    expect(await second).toBeUndefined();
  });

  test('a failure releases the button', async () => {
    const seen = setup();
    const gate = deferred();

    let attempt;
    act(() => {
      attempt = seen.run(() => gate.promise);
    });

    await act(async () => {
      gate.reject(new Error('insufficient balance'));
      await expect(attempt).rejects.toThrow('insufficient balance');
    });

    // Nothing was recorded, so the user has to be able to correct it and try again.
    expect(seen.busy).toBe(false);
  });

  test('the action can be run again once the first has finished', async () => {
    const seen = setup();
    let starts = 0;

    await act(async () => {
      await seen.run(() => {
        starts += 1;
        return Promise.resolve();
      });
    });
    await act(async () => {
      await seen.run(() => {
        starts += 1;
        return Promise.resolve();
      });
    });

    expect(starts).toBe(2);
  });

  test('it returns what the action returned', async () => {
    const seen = setup();
    let value;
    await act(async () => {
      value = await seen.run(() => Promise.resolve({ id: 7 }));
    });
    expect(value).toEqual({ id: 7 });
  });

  test('a form that closes itself mid-flight does not warn', async () => {
    const seen = setup();
    const gate = deferred();
    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      let attempt;
      act(() => {
        attempt = seen.run(() => gate.promise);
      });
      harness.unmount();
      harness = null;
      await act(async () => {
        gate.resolve();
        await attempt;
      });
    } finally {
      console.error = realError;
    }

    // Success usually closes the form, so the component is gone before the promise settles.
    // That is ordinary here and must not produce a warning about updating a dead component.
    expect(errors.join('\n')).not.toMatch(/unmounted|not wrapped in act/i);
  });
});
