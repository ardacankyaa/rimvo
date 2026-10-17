import type { WaveformData, WaveformLevel, WaveformPeak } from '../audio/types';

export interface AnalyzeWaveformOptions {
  readonly baseBlockFrames?: number;
}

function makePeak(minimum: number, maximum: number): WaveformPeak {
  return Object.freeze({ min: minimum, max: maximum });
}

function foldPeaks(peaks: readonly WaveformPeak[]): readonly WaveformPeak[] {
  const folded: WaveformPeak[] = [];
  for (let index = 0; index < peaks.length; index += 2) {
    const first = peaks[index];
    const second = peaks[index + 1];
    folded.push(makePeak(
      second ? Math.min(first.min, second.min) : first.min,
      second ? Math.max(first.max, second.max) : first.max,
    ));
  }
  return Object.freeze(folded);
}

export function analyzeWaveform(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: AnalyzeWaveformOptions = {},
): WaveformData {
  const requestedBlockFrames = options.baseBlockFrames ?? 128;
  const minimumForTrack = options.baseBlockFrames === undefined
    ? Math.max(1, Math.ceil((channels[0]?.length ?? 0) / 16_384))
    : 1;
  const baseBlockFrames = Math.max(requestedBlockFrames, minimumForTrack);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be finite and greater than zero.');
  }
  if (!Number.isSafeInteger(baseBlockFrames) || baseBlockFrames <= 0) {
    throw new RangeError('Waveform block size must be a positive safe integer.');
  }
  if (channels.length < 1 || channels.length > 2 || channels.some((channel) => !(channel instanceof Float32Array))) {
    throw new TypeError('Waveform analysis requires one or two Float32Array channels.');
  }

  const frameCount = channels[0].length;
  if (channels.some((channel) => channel.length !== frameCount)) {
    throw new RangeError('Waveform channels must have the same frame count.');
  }

  const channelPeaks: WaveformPeak[][] = [[], []];
  for (let start = 0; start < frameCount; start += baseBlockFrames) {
    const end = Math.min(frameCount, start + baseBlockFrames);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      const data = channels[channelIndex];
      for (let frame = start; frame < end; frame += 1) {
        const value = data[frame];
        const sample = Number.isFinite(value) ? value : 0;
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
      }
      channelPeaks[channelIndex].push(makePeak(minimum, maximum));
    }
  }

  const levels: WaveformLevel[] = [];
  let blockFrames = baseBlockFrames;
  let left = Object.freeze(channelPeaks[0]);
  let right = channels.length === 2 ? Object.freeze(channelPeaks[1]) : null;
  while (left.length > 0) {
    levels.push(Object.freeze({ blockFrames, left, right }));
    if (left.length === 1) break;
    left = foldPeaks(left);
    if (right) right = foldPeaks(right);
    blockFrames *= 2;
  }

  return Object.freeze({
    sampleRate,
    frameCount,
    channels: channels.length as 1 | 2,
    baseBlockFrames,
    levels: Object.freeze(levels),
  });
}
