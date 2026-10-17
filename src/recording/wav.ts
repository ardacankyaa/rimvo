/** Stereo PCM16 WAV. The stopped PCM chunks stay reusable for versioned exports. */
export function encodeRecordingWav(chunks: readonly Int16Array[], sampleRate: number): Blob {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported recording sample rate.');
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (!bytes || bytes % 4 || bytes > 0xffffffff - 36) throw new RangeError('The recording has no complete stereo frames.');
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes, true);
  const parts: BlobPart[] = [header];
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  for (const chunk of chunks) {
    if (littleEndian) {
      parts.push((chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
        ? chunk.buffer : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)) as ArrayBuffer);
      continue;
    }
    const buffer = new ArrayBuffer(chunk.byteLength);
    const samples = new DataView(buffer);
    for (let index = 0; index < chunk.length; index++) samples.setInt16(index * 2, chunk[index], true);
    parts.push(buffer);
  }
  return new Blob(parts, { type: 'audio/wav' });
}
