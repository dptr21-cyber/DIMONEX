/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/lib/thresholdAudio.ts
 * Zero-dependency Web Audio API synthesizer for Market Maker price threshold alerts.
 */

import { PriceThresholdSoundTone } from '../types/index.js';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  type: OscillatorType = 'sine',
  peakGain = 0.16
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + startOffsetSec;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t0);
  osc.stop(t0 + durationSec + 0.02);
}

export function playThresholdSound(tone: PriceThresholdSoundTone): boolean {
  if (!tone || tone === 'NONE') return false;
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    switch (tone) {
      case 'PING':
        scheduleTone(ctx, 1046.5, 0, 0.22, 'sine', 0.16);
        break;
      case 'CHIME':
        scheduleTone(ctx, 783.99, 0, 0.18, 'triangle', 0.15);
        scheduleTone(ctx, 1046.5, 0.14, 0.28, 'triangle', 0.15);
        break;
      case 'ALERT_DOUBLE':
        scheduleTone(ctx, 880, 0, 0.12, 'square', 0.08);
        scheduleTone(ctx, 1174.66, 0.15, 0.16, 'square', 0.08);
        scheduleTone(ctx, 1174.66, 0.34, 0.22, 'square', 0.09);
        break;
      case 'SIREN':
        scheduleTone(ctx, 660, 0, 0.18, 'sawtooth', 0.09);
        scheduleTone(ctx, 990, 0.18, 0.18, 'sawtooth', 0.09);
        scheduleTone(ctx, 660, 0.36, 0.18, 'sawtooth', 0.09);
        scheduleTone(ctx, 990, 0.54, 0.22, 'sawtooth', 0.09);
        break;
      default:
        scheduleTone(ctx, 880, 0, 0.2, 'sine', 0.14);
        break;
    }
    return true;
  } catch {
    return false;
  }
}
