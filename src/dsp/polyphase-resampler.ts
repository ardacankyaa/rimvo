const TAPS = 64;
const FIRST_TAP = -31;
const PHASES = 128;
const RATE_STEPS = 32;
const rates = RATE_STEPS + 1;
const coefficients = new Float32Array(rates * PHASES * TAPS);

function sinc(value: number): number {
  if (Math.abs(value) < 1e-12) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

for (let rateIndex = 0; rateIndex < rates; rateIndex += 1) {
  const playbackRate = 1 + rateIndex / RATE_STEPS;
  const cutoff = 1 / playbackRate;
  for (let phase = 0; phase < PHASES; phase += 1) {
    const fraction = phase / PHASES;
    const base = (rateIndex * PHASES + phase) * TAPS;
    let sum = 0;
    for (let tap = 0; tap < TAPS; tap += 1) {
      const distance = FIRST_TAP + tap - fraction;
      const coefficient = cutoff * sinc(cutoff * distance) * sinc(distance / (TAPS / 2));
      coefficients[base + tap] = coefficient;
      sum += coefficient;
    }
    const scale = sum === 0 ? 1 : 1 / sum;
    for (let tap = 0; tap < TAPS; tap += 1) coefficients[base + tap] *= scale;
  }
}

/** Reads a fractional source frame using a precomputed band-limited polyphase filter. */
export function readBandlimitedSample(
  source: Float32Array,
  positionFrame: number,
  playbackRate: number,
  loopStartFrame?: number,
  loopEndFrame?: number,
): number {
  if (!Number.isFinite(positionFrame) || !Number.isFinite(playbackRate) || playbackRate === 0) return 0;
  const magnitude = Math.min(2, Math.abs(playbackRate));
  const rateIndex = Math.max(0, Math.ceil((magnitude - 1) * RATE_STEPS));
  const boundedPosition = Math.max(-1, Math.min(source.length, positionFrame));
  const integerFrame = Math.floor(boundedPosition);
  const fraction = boundedPosition - integerFrame;
  const phaseIndex = Math.min(PHASES - 1, Math.round(fraction * PHASES));
  const phaseBase = (rateIndex * PHASES + phaseIndex) * TAPS;
  const hasLoop = Number.isFinite(loopStartFrame) && Number.isFinite(loopEndFrame)
    && loopStartFrame! >= 0 && loopEndFrame! > loopStartFrame! && loopEndFrame! <= source.length;
  const loopStartSample = hasLoop ? Math.ceil(loopStartFrame!) : 0;
  const loopEndSample = hasLoop ? Math.ceil(loopEndFrame!) - 1 : -1;
  const loopSampleCount = hasLoop ? loopEndSample - loopStartSample + 1 : 0;
  let sample = 0;
  for (let tap = 0; tap < TAPS; tap += 1) {
    let sourceFrame = integerFrame + FIRST_TAP + tap;
    if (hasLoop && loopSampleCount > 0) {
      const offset = sourceFrame - loopStartSample;
      sourceFrame = loopStartSample + ((offset % loopSampleCount) + loopSampleCount) % loopSampleCount;
    }
    if (sourceFrame >= 0 && sourceFrame < source.length) {
      const value = source[sourceFrame];
      if (Number.isFinite(value)) sample += value * coefficients[phaseBase + tap];
    }
  }
  return Number.isFinite(sample) ? sample : 0;
}