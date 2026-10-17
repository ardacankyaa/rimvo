import { AudioEngineError } from './errors';

export interface Mp3ScanResult {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly durationSeconds: number;
  readonly frameCount: number;
}

interface Mp3FrameHeader {
  readonly version: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly bitrateKbps: number;
  readonly frameBytes: number;
  readonly samplesPerFrame: number;
}

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const BASE_SAMPLE_RATES = [44_100, 48_000, 32_000];

function hasText(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  return true;
}

function parseFrame(bytes: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const header = (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
  if ((header >>> 21) !== 0x7ff) return null;
  const version = (header >>> 19) & 3;
  const layer = (header >>> 17) & 3;
  const bitrateIndex = (header >>> 12) & 15;
  const sampleIndex = (header >>> 10) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const divisor = version === 3 ? 1 : version === 2 ? 2 : 4;
  const sampleRate = BASE_SAMPLE_RATES[sampleIndex] / divisor;
  const bitrateKbps = (version === 3 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex];
  const padding = (header >>> 9) & 1;
  const frameBytes = Math.floor((version === 3 ? 144 : 72) * bitrateKbps * 1000 / sampleRate) + padding;
  if (!frameBytes || offset + frameBytes > bytes.length) return null;
  return {
    version,
    sampleRate,
    channels: (((header >>> 6) & 3) === 3 ? 1 : 2),
    bitrateKbps,
    frameBytes,
    samplesPerFrame: version === 3 ? 1152 : 576,
  };
}

function skipId3(bytes: Uint8Array): number {
  if (!hasText(bytes, 0, 'ID3')) return 0;
  if (bytes.length < 10) throw new AudioEngineError('corrupt-file', 'The MP3 ID3 header is truncated.', true, 'admission');
  const sizeBytes = [bytes[6], bytes[7], bytes[8], bytes[9]];
  if (sizeBytes.some(value => (value & 0x80) !== 0)) throw new AudioEngineError('corrupt-file', 'The MP3 ID3 length is invalid.', true, 'admission');
  const size = sizeBytes.reduce((total, value) => (total * 128) + value, 0);
  const footerBytes = (bytes[5] & 0x10) !== 0 ? 10 : 0;
  const start = 10 + size + footerBytes;
  if (start >= bytes.length) throw new AudioEngineError('corrupt-file', 'The MP3 contains no audio frame after its ID3 tag.', true, 'admission');
  return start;
}

function isId3v1Tail(bytes: Uint8Array, offset: number): boolean {
  return bytes.length - offset === 128 && hasText(bytes, offset, 'TAG');
}

export function scanMp3Frames(buffer: ArrayBuffer, maxDurationSeconds: number): Mp3ScanResult {
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) throw new RangeError('MP3 duration limit must be positive.');
  const bytes = new Uint8Array(buffer);
  let offset = skipId3(bytes);
  let first: Mp3FrameHeader | null = null;
  let frames = 0;
  let duration = 0;
  let resyncBudget = 0;
  let lastAcceptedEnd = offset;
  let acceptedTail = false;

  while (offset < bytes.length) {
    if (isId3v1Tail(bytes, offset)) {
      acceptedTail = true;
      break;
    }
    const frame = parseFrame(bytes, offset);
    if (!frame) {
      offset += 1;
      resyncBudget += 1;
      if (resyncBudget > 8192) {
        throw new AudioEngineError('corrupt-file', 'The MP3 contains unparsed data between audio frames.', true, 'admission');
      }
      continue;
    }

    const nextOffset = offset + frame.frameBytes;
    const nextIsFrame = nextOffset + 4 <= bytes.length && parseFrame(bytes, nextOffset) !== null;
    const nextIsTail = nextOffset === bytes.length || isId3v1Tail(bytes, nextOffset);
    if (!nextIsFrame && !nextIsTail) {
      offset += 1;
      resyncBudget += 1;
      if (resyncBudget > 8192) {
        throw new AudioEngineError('corrupt-file', 'The MP3 contains an incomplete frame or unparsed trailing data.', true, 'admission');
      }
      continue;
    }

    first ??= frame;
    frames += 1;
    duration += frame.samplesPerFrame / frame.sampleRate;
    if (duration > maxDurationSeconds) {
      throw new AudioEngineError('duration-too-long', 'MP3 tracks are limited to eight minutes.', true, 'admission');
    }
    offset = nextOffset;
    lastAcceptedEnd = nextOffset;
    resyncBudget = 0;
  }

  if (!acceptedTail && offset !== lastAcceptedEnd) {
    throw new AudioEngineError('corrupt-file', 'The MP3 contains unparsed trailing data.', true, 'admission');
  }
  if (!first || frames < 2 || duration <= 0) {
    throw new AudioEngineError('corrupt-file', 'No complete MP3 Layer III audio frames were found.', true, 'admission');
  }
  return { sampleRate: first.sampleRate, channels: first.channels, durationSeconds: duration, frameCount: frames };
}
