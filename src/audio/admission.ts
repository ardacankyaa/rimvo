import { AudioEngineError } from './errors';
import { scanMp3Frames } from './mp3-scan';
import { createTrackedWorker } from './worker-ledger';
import mp3WorkerUrl from './mp3-preflight.worker.ts?worker&url';
import type { AudioEngineErrorCode, SupportedAudioFormat } from './types';
export { AudioEngineError } from './errors';

export interface AudioAdmissionOptions {
  readonly maxEncodedBytes: number;
  readonly maxDecodedPcmBytes?: number;
  readonly maxDurationSeconds: number;
  readonly targetSampleRate?: number;
}

export interface AudioFileDescriptor {
  readonly format: SupportedAudioFormat;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  readonly durationSeconds: number | null;
  /** Private ownership returned by the MP3 worker to avoid a second full-file read. */
  readonly encodedBytes?: ArrayBuffer;
}

const HEADER_BYTES = 1024 * 1024;
const fail = (code: AudioEngineErrorCode, message: string): never => {
  throw new AudioEngineError(code, message, true, 'admission');
};

function text(view: DataView, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > view.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (view.getUint8(offset + index) !== value.charCodeAt(index)) return false;
  }
  return true;
}

function validateDescriptor(descriptor: AudioFileDescriptor, options: AudioAdmissionOptions): AudioFileDescriptor {
  const duration = descriptor.durationSeconds;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    throw new AudioEngineError('duration-too-long', 'The file does not declare a bounded duration, so it cannot be decoded safely.', true, 'admission');
  }
  if (duration > options.maxDurationSeconds) fail('duration-too-long', 'Audio tracks are limited to eight minutes.');
  const maxPcmBytes = options.maxDecodedPcmBytes;
  if (maxPcmBytes && descriptor.sampleRate && descriptor.channels) {
    const sourceBytes = Math.ceil(duration * descriptor.sampleRate) * descriptor.channels * 4;
    const targetRate = options.targetSampleRate ?? descriptor.sampleRate;
    const targetBytes = Math.ceil(duration * targetRate) * descriptor.channels * 4;
    if (sourceBytes > maxPcmBytes || targetBytes > maxPcmBytes) {
      fail('file-too-large', 'The estimated source or resampled PCM exceeds the per-deck audio memory limit.');
    }
  }
  return descriptor;
}

function inspectWave(view: DataView, fileBytes: number): AudioFileDescriptor {
  if (!text(view, 0, 'RIFF') || !text(view, 8, 'WAVE')) fail('corrupt-file', 'The WAV header is invalid.');
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let dataSize = -1;
  let hasFormat = false;
  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    const end = body + size;
    if (end > fileBytes) fail('corrupt-file', 'A WAV chunk extends beyond the file.');
    if (text(view, offset, 'fmt ')) {
      if (size < 16 || body + 16 > view.byteLength) fail('corrupt-file', 'The WAV format chunk is truncated.');
      const encoding = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      const supportedDepth = [8, 16, 24, 32].includes(bitsPerSample);
      if (![1, 3, 0xfffe].includes(encoding) || !supportedDepth || (encoding === 3 && bitsPerSample !== 32)) {
        fail('unsupported-format', 'Only PCM and 32-bit IEEE float WAV files are supported.');
      }
      if (channels > 2) fail('too-many-channels', 'Audio files with more than two channels are not supported.');
      const expectedBlockAlign = channels * Math.ceil(bitsPerSample / 8);
      if (channels < 1 || sampleRate < 8000 || sampleRate > 192000 || blockAlign !== expectedBlockAlign) {
        fail('corrupt-file', 'The WAV format metadata is invalid.');
      }
      hasFormat = true;
    } else if (text(view, offset, 'data')) {
      dataSize = size;
      break;
    }
    offset = end + (size & 1);
  }
  if (!hasFormat || dataSize <= 0 || !blockAlign) fail('corrupt-file', 'The WAV file has no usable format and audio data chunks.');
  if (dataSize % blockAlign !== 0) fail('corrupt-file', 'The WAV audio data does not contain a whole number of sample frames.');
  const durationSeconds = dataSize / blockAlign / sampleRate;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) fail('corrupt-file', 'The WAV duration is invalid.');
  return { format: 'wav', sampleRate, channels, durationSeconds };
}

function inspectFlac(view: DataView): AudioFileDescriptor {
  if (!text(view, 0, 'fLaC')) fail('corrupt-file', 'The FLAC header is invalid.');
  let offset = 4;
  let streamInfo: number | null = null;
  while (offset + 4 <= view.byteLength) {
    const blockHeader = view.getUint8(offset);
    const blockType = blockHeader & 0x7f;
    const last = (blockHeader & 0x80) !== 0;
    const length = view.getUint8(offset + 1) * 65536 + view.getUint8(offset + 2) * 256 + view.getUint8(offset + 3);
    const body = offset + 4;
    if (body + length > view.byteLength) fail('corrupt-file', 'The FLAC metadata is truncated.');
    if (blockType === 0) {
      if (length !== 34) fail('corrupt-file', 'The FLAC STREAMINFO block has an invalid length.');
      streamInfo = body;
      break;
    }
    offset = body + length;
    if (last) break;
  }
  const infoOffset = streamInfo;
  if (infoOffset === null) throw new AudioEngineError('corrupt-file', 'The FLAC file has no STREAMINFO block.', true, 'admission');
  let packed = 0n;
  for (let index = 0; index < 8; index += 1) packed = (packed << 8n) | BigInt(view.getUint8(infoOffset + 10 + index));
  const sampleRate = Number(packed >> 44n);
  const channels = Number((packed >> 41n) & 0x7n) + 1;
  const totalSamples = Number(packed & ((1n << 36n) - 1n));
  if (sampleRate < 8000 || sampleRate > 192000) fail('corrupt-file', 'The FLAC sample rate is invalid.');
  if (channels > 2) fail('too-many-channels', 'Audio files with more than two channels are not supported.');
  if (totalSamples === 0) return { format: 'flac', sampleRate, channels, durationSeconds: null };
  return { format: 'flac', sampleRate, channels, durationSeconds: totalSamples / sampleRate };
}

/** End of a leading ID3v2 tag, or 0 when the prefix has none or its length is malformed. */
function id3v2End(view: DataView): number {
  if (!text(view, 0, 'ID3') || view.byteLength < 10) return 0;
  let size = 0;
  for (let index = 6; index < 10; index += 1) {
    const value = view.getUint8(index);
    if (value & 0x80) return 0;
    size = size * 128 + value;
  }
  return 10 + size + ((view.getUint8(5) & 0x10) !== 0 ? 10 : 0);
}

let nextMp3RequestId = 0;
async function inspectMp3Blob(blob: Blob, maxDurationSeconds: number, signal?: AbortSignal): Promise<AudioFileDescriptor> {
  if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
  if (typeof Worker === 'undefined') {
    const encodedBytes = await blob.arrayBuffer();
    const scan = scanMp3Frames(encodedBytes, maxDurationSeconds);
    return { format: 'mp3', ...scan, encodedBytes };
  }
  const worker = createTrackedWorker(mp3WorkerUrl, { type: 'module' });
  const id = ++nextMp3RequestId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback();
    };
    const abort = (): void => finish(() => reject(new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission')));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(() => reject(new AudioEngineError('internal', event.message || 'MP3 admission worker failed.', true, 'admission')));
    worker.onmessageerror = () => finish(() => reject(new AudioEngineError('internal', 'The audio file could not be analysed.', true, 'admission')));
    worker.onmessage = (event: MessageEvent<{ readonly id: number; readonly scan?: { sampleRate: number; channels: 1 | 2; durationSeconds: number; frameCount: number }; readonly encodedBytes?: ArrayBuffer; readonly error?: string; readonly code?: AudioEngineErrorCode }>) => {
      const result = event.data;
      if (result.id !== id) return;
      if (result.error || !result.scan || !result.encodedBytes) {
        finish(() => reject(new AudioEngineError(result.code ?? 'corrupt-file', result.error ?? 'MP3 admission worker returned incomplete data.', true, 'admission')));
        return;
      }
      const scan = result.scan;
      const encodedBytes = result.encodedBytes;
      finish(() => resolve({ format: 'mp3', sampleRate: scan.sampleRate, channels: scan.channels, durationSeconds: scan.durationSeconds, encodedBytes }));
    };
    try { worker.postMessage({ id, blob, maxDurationSeconds }); }
    catch (cause) { finish(() => reject(new AudioEngineError('worker-unavailable', cause instanceof Error ? cause.message : 'Could not start MP3 admission worker.', true, 'admission'))); }
  });
}

export async function inspectAudioBlob(blob: Blob, options: AudioAdmissionOptions, signal?: AbortSignal): Promise<AudioFileDescriptor> {
  if (!Number.isFinite(blob.size) || blob.size <= 0) fail('corrupt-file', 'The selected audio file is empty.');
  if (blob.size > options.maxEncodedBytes) fail('file-too-large', 'The encoded audio file exceeds the 128 MiB limit.');
  if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
  const prefix = new DataView(await blob.slice(0, Math.min(12, blob.size)).arrayBuffer());
  if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
  const tagEnd = id3v2End(prefix);
  if (tagEnd > 0 && tagEnd + 4 <= blob.size && text(new DataView(await blob.slice(tagEnd, tagEnd + 4).arrayBuffer()), 0, 'fLaC')) {
    // FLAC behind an ID3v2 tag: parse and decode the stream without the tag.
    const encodedBytes = await blob.slice(tagEnd).arrayBuffer();
    if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
    return validateDescriptor({ ...inspectFlac(new DataView(encodedBytes, 0, Math.min(HEADER_BYTES, encodedBytes.byteLength))), encodedBytes }, options);
  }
  if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
  const mp3 = text(prefix, 0, 'ID3') || (prefix.byteLength >= 2 && prefix.getUint8(0) === 0xff && (prefix.getUint8(1) & 0xe0) === 0xe0);
  if (mp3) return validateDescriptor(await inspectMp3Blob(blob, options.maxDurationSeconds, signal), options);
  const header = await blob.slice(0, Math.min(HEADER_BYTES, blob.size)).arrayBuffer();
  if (signal?.aborted) throw new AudioEngineError('aborted', 'The audio load was cancelled.', true, 'admission');
  const view = new DataView(header);
  if (text(view, 0, 'RIFF')) return validateDescriptor(inspectWave(view, blob.size), options);
  if (text(view, 0, 'fLaC')) return validateDescriptor(inspectFlac(view), options);
  return fail('unsupported-format', 'Choose a valid MP3, WAV, or FLAC file.');
}

export function safeTrackName(file: File | Blob, requested?: string): string {
  const candidate = requested || (typeof File !== 'undefined' && file instanceof File ? file.name : '') || 'Audio track';
  const leaf = candidate.split('\\').join('/').split('/').pop() ?? '';
  const normalized = Array.from(leaf).filter(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x1f && codePoint !== 0x7f;
  }).join('').trim();
  return (normalized || 'Audio track').slice(0, 128);
}
