// Web Audio API Sound Chime Engine
// Plays pleasant, studio-grade notification sounds without requiring external asset downloads

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        sharedAudioContext = new AudioCtxClass();
      }
    }
    if (sharedAudioContext && sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Plays a modern, crisp two-tone bell chime for incoming messages
 */
export function playMessageChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Harmonic bell tone 1 (D5 - 587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.22, now + 0.025);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Harmonic bell tone 2 (A5 - 880.00 Hz, with soft decay)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.09);
    gain2.gain.setValueAtTime(0, now + 0.09);
    gain2.gain.linearRampToValueAtTime(0.28, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.65);

    // Warm sub-harmonic resonance (F#5 - 739.99 Hz)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "triangle";
    osc3.frequency.setValueAtTime(739.99, now + 0.14);
    gain3.gain.setValueAtTime(0, now + 0.14);
    gain3.gain.linearRampToValueAtTime(0.12, now + 0.17);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.14);
    osc3.stop(now + 0.5);
  } catch (err) {
    console.debug("Message chime playback deferred (pending user interaction):", err);
  }
}

/**
 * Plays a subtle pop sound for actions like sending a message or reaction
 */
export function playSendChirp() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch {
    // Ignore audio errors
  }
}

/**
 * Plays a pleasant double-pulse studio ringtone burst for incoming calls/meetings
 */
export function playIncomingRingCycle() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pulses = [0, 0.32];

    pulses.forEach((offset) => {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const gain = ctx.createGain();

      oscA.type = "sine";
      oscB.type = "triangle";
      oscA.frequency.setValueAtTime(659.25, now + offset); // E5
      oscB.frequency.setValueAtTime(880.0, now + offset);  // A5

      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(0.22, now + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.26);

      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(ctx.destination);

      oscA.start(now + offset);
      oscB.start(now + offset);
      oscA.stop(now + offset + 0.27);
      oscB.stop(now + offset + 0.27);
    });
  } catch {
    // Ignore audio errors
  }
}

/**
 * Plays a soft outgoing ringback tone while waiting for the teammate to answer
 */
export function playRingbackTone() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.56);
  } catch {
    // Ignore audio errors
  }
}

