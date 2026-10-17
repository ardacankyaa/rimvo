import { Mp3Encoder } from '@breezystack/lamejs';

/** Encode our canonical PCM16 stereo WAV in bounded blocks, preserving the source. */
export function encodeRecordingMp3(wav: ArrayBuffer): Blob {
  const view = new DataView(wav);
  if (wav.byteLength <= 44 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(36) !== 0x64617461 || view.getUint32(40, true) !== wav.byteLength - 44 || (wav.byteLength - 44) % 4) {
    throw new Error('The recording has no valid stereo PCM audio to encode.');
  }
  const sampleRate = view.getUint32(24, true);
  if (sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported recording sample rate.');
  const encoder = new Mp3Encoder(2, sampleRate, 320);
  const frames = (wav.byteLength - 44) / 4;
  const left = new Int16Array(1152), right = new Int16Array(1152);
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < frames; offset += left.length) {
    const count = Math.min(left.length, frames - offset);
    for (let index = 0; index < count; index++) {
      left[index] = view.getInt16(44 + (offset + index) * 4, true);
      right[index] = view.getInt16(46 + (offset + index) * 4, true);
    }
    const encoded = encoder.encodeBuffer(left.subarray(0, count), right.subarray(0, count));
    if (encoded.length) parts.push(new Uint8Array(encoded).buffer);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail).buffer);
  return new Blob(parts, { type: 'audio/mpeg' });
}
