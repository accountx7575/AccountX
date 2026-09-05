let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

export function playTone(frequencyHz: number, durationMs = 90): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequencyHz;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch {
    /* audio unavailable — fail silently */
  }
}

export function buzz(pattern: number | number[] = 15): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* haptics unavailable — fail silently */
  }
}

const TIER_TONES: Record<number, number> = { 1: 220, 2: 330, 3: 440, 4: 587 };

export function signalTierUp(tier: number): void {
  if (tier < 1 || tier > 4) return;
  playTone(TIER_TONES[tier] ?? 440);
  buzz(12);
}

export function signalLocked(): void {
  playTone(660, 120);
  buzz([10, 30, 10]);
}
