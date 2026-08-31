/**
 * A short tone confirming a scan, so the operator does not have to look up at the screen.
 *
 * Synthesised with WebAudio rather than shipped as an audio file: no asset to load, nothing to
 * fetch at the moment it is needed, and no chance of the first scan of the day being silent
 * because a request was still in flight.
 *
 * Every entry point is guarded and swallows its own errors. A missing beep is a small annoyance;
 * an exception thrown out of a scan handler would lose the scan itself.
 */

let audioContext = null;

function context() {
  if (audioContext) return audioContext;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null; // jsdom, and any browser without WebAudio
  try {
    audioContext = new Ctor();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

/**
 * Wake the audio context on a user gesture.
 *
 * Chrome starts every context suspended until the page has been interacted with, so the first
 * beep would be silently dropped. Call this from the click that opens the sale form — that click
 * is the gesture.
 */
export function primeScanBeep() {
  const ctx = context();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone(frequency, durationMs, gainValue) {
  const ctx = context();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = gainValue;
    oscillator.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    const end = now + durationMs / 1000;
    // Ramp the tail to zero: an oscillator stopped at full amplitude ends on a click.
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.start(now);
    oscillator.stop(end);
  } catch {
    // Nothing to do — a beep is never worth an exception.
  }
}

/** Short and high: the item went into the basket. */
export function beepOk() {
  tone(880, 60, 0.05);
}

/** Longer and low, so it cannot be mistaken for the other one across a noisy shop. */
export function beepError() {
  tone(200, 220, 0.07);
}
