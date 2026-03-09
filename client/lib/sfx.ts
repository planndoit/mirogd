'use client';

type SfxName = 'tap' | 'join' | 'start' | 'caught' | 'win' | 'lose';

type Step = {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  release?: number;
};

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

async function ensureRunning() {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (_) {
      return null;
    }
  }
  return ctx.state === 'running' ? ctx : null;
}

function scheduleStep(ctx: AudioContext, startAt: number, step: Step) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = step.attack ?? 0.01;
  const release = step.release ?? 0.08;
  const peak = step.volume ?? 0.08;
  const endAt = startAt + step.duration;

  oscillator.type = step.type ?? 'sine';
  oscillator.frequency.setValueAtTime(step.frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(startAt + attack + 0.01, endAt + release));

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startAt);
  oscillator.stop(endAt + release);
}

function getSequence(name: SfxName): Step[] {
  switch (name) {
    case 'tap':
      return [
        { frequency: 720, duration: 0.04, type: 'square', volume: 0.03, attack: 0.003, release: 0.03 },
      ];
    case 'join':
      return [
        { frequency: 420, duration: 0.06, type: 'triangle', volume: 0.05 },
        { frequency: 630, duration: 0.08, type: 'triangle', volume: 0.055 },
      ];
    case 'start':
      return [
        { frequency: 520, duration: 0.08, type: 'triangle', volume: 0.05 },
        { frequency: 660, duration: 0.08, type: 'triangle', volume: 0.055 },
        { frequency: 880, duration: 0.12, type: 'triangle', volume: 0.06 },
      ];
    case 'caught':
      return [
        { frequency: 280, duration: 0.08, type: 'sawtooth', volume: 0.055 },
        { frequency: 180, duration: 0.12, type: 'sawtooth', volume: 0.04 },
      ];
    case 'win':
      return [
        { frequency: 523.25, duration: 0.1, type: 'triangle', volume: 0.055 },
        { frequency: 659.25, duration: 0.1, type: 'triangle', volume: 0.06 },
        { frequency: 783.99, duration: 0.16, type: 'triangle', volume: 0.065 },
      ];
    case 'lose':
      return [
        { frequency: 392, duration: 0.08, type: 'sine', volume: 0.045 },
        { frequency: 293.66, duration: 0.08, type: 'sine', volume: 0.04 },
        { frequency: 220, duration: 0.16, type: 'sine', volume: 0.035 },
      ];
  }
}

export async function playSfx(name: SfxName) {
  const ctx = await ensureRunning();
  if (!ctx) return;

  let cursor = ctx.currentTime;
  for (const step of getSequence(name)) {
    scheduleStep(ctx, cursor, step);
    cursor += step.duration;
  }
}
