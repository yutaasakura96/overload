// How the end of rest is announced (docs/06, 2026-10-03): a short tone, since an installed iOS app
// has no vibration and push needs signal the gym may not have (docs/03 §11). The tone plays only
// while the app is on screen, so where the Screen Wake Lock works (a standalone app from iOS 18.4)
// the screen is kept awake for the length of the rest and no longer.

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let context: AudioContext | undefined;

/**
 * Call from the tap that completes a set: browsers start audio only from a user gesture, and the
 * context made or resumed here is the one the tone plays on when rest ends.
 */
export function unlockTone() {
  try {
    // A notification ping that plays over music rather than pausing it, where the browser has the
    // Audio Session API. Whether iOS then ignores the silent switch is checked on the phone
    // (docs/11 §3).
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session !== undefined) session.type = 'transient';
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch {
    // No audio: the rest bar still turns and says rest is over.
  }
}

/** Two short beeps. Silent when audio was never unlocked or the browser refuses. */
export function playTone() {
  if (context === undefined || context.state !== 'running') return;
  const start = context.currentTime;
  for (const offset of [0, 0.22]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.18);
  }
}

/**
 * Keeps the screen awake until the returned function is called. A progressive enhancement: where
 * the lock is missing or refused, nothing happens (docs/03 §11).
 */
export function keepAwake(): () => void {
  let released = false;
  let lock: WakeLockSentinel | undefined;
  const request = () => {
    if (released || document.visibilityState !== 'visible') return;
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      })
      .catch(() => undefined);
  };
  // The browser drops the lock when the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', request);
  request();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', request);
    void lock?.release().catch(() => undefined);
  };
}
