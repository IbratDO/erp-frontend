import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run one action at a time and report while it is running.
 *
 * The shop's writes take a moment — paying an order moves cash, writes finance records and
 * re-splits freight before it answers — and for that moment the screen looks untouched, so the
 * button gets pressed again. `api.js` refuses the duplicate request, but silently: the user is
 * still staring at a button that appears to do nothing. This is the half they can see.
 *
 * The guard is a ref rather than the state, because a second click can land in the same tick as
 * the first and would read the old `false` from the render it came from. The ref is already
 * true by then.
 *
 * Unmounting mid-flight is ordinary here — a form usually closes itself on success — so the
 * final `setBusy` is skipped once the component is gone, rather than warning about a state
 * update on something that no longer exists.
 *
 * **The effect must set `alive` on the way in, not only clear it on the way out.** In
 * development React runs every effect twice — mount, unmount, mount again — on the same hook
 * state. A cleanup that only sets the flag false leaves it false for the remounted component,
 * which then never re-enables its own button: press it once and it says "Yuklanmoqda…" for
 * ever. That is invisible on success, because the form closes over it, and obvious on a failure,
 * because the form stays open with a dead button on it.
 *
 * Returns `[busy, run]`. `run` gives back whatever the action returned, or `undefined` when it
 * declined to start because one was already going.
 */
export default function useBusy() {
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(async (action) => {
    if (runningRef.current) return undefined;
    runningRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      runningRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  return [busy, run];
}
