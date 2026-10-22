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

function parseHeader(bytes: Uint8Array, offset: number, end: number): Mp3FrameHeader | null {
  if (offset < 0 || offset + 4 > end) return null;
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
  if (!frameBytes) return null;
  return {
    version,
    sampleRate,
    channels: (((header >>> 6) & 3) === 3 ? 1 : 2),
    bitrateKbps,
    frameBytes,
    samplesPerFrame: version === 3 ? 1152 : 576,
  };
}

function parseFrame(bytes: Uint8Array, offset: number, end: number): Mp3FrameHeader | null {
  const header = parseHeader(bytes, offset, end);
  return header && offset + header.frameBytes <= end ? header : null;
}

/** A final frame cut short by the end of the audio region; its partial bytes are ignored. */
function isTruncatedFrame(bytes: Uint8Array, offset: number, end: number): boolean {
  const remaining = end - offset;
  if (remaining <= 0) return false;
  if (remaining < 4) return bytes[offset] === 0xff && (remaining < 2 || (bytes[offset + 1] & 0xe0) === 0xe0);
  const header = parseHeader(bytes, offset, end);
  return header !== null && offset + header.frameBytes > end;
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000;
}

/** Strips trailing ID3v1, APEv2 and Lyrics3 v1/v2 tags (in any order) and returns where audio frames end. */
function audioEnd(bytes: Uint8Array, start: number): number {
  let end = bytes.length;
  for (let changed = true; changed;) {
    changed = false;
    if (end - start >= 128 && hasText(bytes, end - 128, 'TAG')) { end -= 128; changed = true; continue; }
    if (end - start >= 32 && hasText(bytes, end - 32, 'APETAGEX')) {
      const footer = end - 32, size = readUint32Le(bytes, footer + 12), hasHeader = (bytes[footer + 23] & 0x80) !== 0;
      const tagStart = end - size - (hasHeader ? 32 : 0);
      if (size >= 32 && tagStart >= start && (!hasHeader || hasText(bytes, tagStart, 'APETAGEX'))) { end = tagStart; changed = true; continue; }
    }
    if (end - start >= 15 + 11 && hasText(bytes, end - 9, 'LYRICS200')) {
      let size = 0, digits = true;
      for (let index = end - 15; index < end - 9; index += 1) { const digit = bytes[index] - 48; if (digit < 0 || digit > 9) digits = false; size = size * 10 + digit; }
      const tagStart = end - 15 - size;
      if (digits && tagStart >= start && hasText(bytes, tagStart, 'LYRICSBEGIN')) { end = tagStart; changed = true; continue; }
    }
    if (end - start >= 9 + 11 && hasText(bytes, end - 9, 'LYRICSEND')) {
      for (let tagStart = end - 20; tagStart >= Math.max(start, end - 9 - 11 - 5100); tagStart -= 1) {
        if (hasText(bytes, tagStart, 'LYRICSBEGIN')) { end = tagStart; changed = true; break; }
      }
    }
  }
  return end;
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

export function scanMp3Frames(buffer: ArrayBuffer, maxDurationSeconds: number): Mp3ScanResult {
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) throw new RangeError('MP3 duration limit must be positive.');
  const bytes = new Uint8Array(buffer);
  let offset = skipId3(bytes);
  let first: Mp3FrameHeader | null = null;
  let frames = 0;
  let duration = 0;
  let resyncBudget = 0;
  let lastAcceptedEnd = offset;
  let truncatedTail = false;
  const end = audioEnd(bytes, offset);

  while (offset < end) {
    const frame = parseFrame(bytes, offset, end);
    if (!frame) {
      if (frames > 0 && offset === lastAcceptedEnd && isTruncatedFrame(bytes, offset, end)) {
        truncatedTail = true;
        break;
      }
      offset += 1;
      resyncBudget += 1;
      if (resyncBudget > 8192) {
        throw new AudioEngineError('corrupt-file', 'The MP3 contains unparsed data between audio frames.', true, 'admission');
      }
      continue;
    }

    const nextOffset = offset + frame.frameBytes;
    const nextIsFrame = parseFrame(bytes, nextOffset, end) !== null;
    const nextIsTail = nextOffset === end || isTruncatedFrame(bytes, nextOffset, end);
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

  if (!truncatedTail && offset !== lastAcceptedEnd) {
    throw new AudioEngineError('corrupt-file', 'The MP3 contains unparsed trailing data.', true, 'admission');
  }
  if (!first || frames < 2 || duration <= 0) {
    throw new AudioEngineError('corrupt-file', 'No complete MP3 Layer III audio frames were found.', true, 'admission');
  }
  return { sampleRate: first.sampleRate, channels: first.channels, durationSeconds: duration, frameCount: frames };
}
