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
 * Returns `[busy, run]`. `run` gives back whatever the action returned, or `undefined` when it
 * declined to start because one was already going.
 */
export default function useBusy() {
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

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
