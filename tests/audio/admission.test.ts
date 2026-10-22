import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AudioEngineError, inspectAudioBlob } from '../../src/audio/admission';

const options = { maxEncodedBytes: 128 * 1024 * 1024, maxDurationSeconds: 480 };
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
const fixture = async (name: string): Promise<Blob> => new Blob([
  toArrayBuffer(new Uint8Array(await readFile(resolve(process.cwd(), 'tests/fixtures', name)))),
]);

function oversizedBlob(size: number, header: Uint8Array): Blob {
  return { size, slice: () => new Blob([toArrayBuffer(header)]) } as unknown as Blob;
}

function longFlacHeader(totalSamples: number): Uint8Array {
  const data = new Uint8Array(42);
  data.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  let packed = (48_000n << 44n) | (1n << 41n) | (15n << 36n) | BigInt(totalSamples);
  for (let index = 25; index >= 18; index -= 1) {
    data[index] = Number(packed & 0xffn);
    packed >>= 8n;
  }
  return data;
}

describe('local audio admission', () => {
  it('recognizes MP3 CBR and VBR fixtures and bounds their measured duration before decode', async () => {
    const cbr = await inspectAudioBlob(await fixture('m1-tone-440-mono-44100-cbr.mp3'), options);
    const vbr = await inspectAudioBlob(await fixture('m1-tone-440-stereo-48000-vbr.mp3'), options);
    expect(cbr).toMatchObject({ format: 'mp3', channels: 1, sampleRate: 44_100 });
    expect(cbr.durationSeconds).toBeGreaterThan(7.5);
    expect(cbr.durationSeconds).toBeLessThan(8.5);
    expect(vbr).toMatchObject({ format: 'mp3', channels: 2, sampleRate: 48_000 });
    expect(vbr.durationSeconds).toBeGreaterThan(7.5);
    expect(vbr.durationSeconds).toBeLessThan(8.5);

    const raw = new Uint8Array(await (await fixture('m1-tone-440-mono-44100-cbr.mp3')).arrayBuffer());
    const extendedTag = new Uint8Array(raw.length + 1_100_000);
    extendedTag.set([0x49, 0x44, 0x33, 4, 0, 0, 0x00, 0x43, 0x11, 0x60]);
    extendedTag.set(raw.subarray(10), 1_100_010);
    const longTag = await inspectAudioBlob(new Blob([toArrayBuffer(extendedTag)]), options);
    expect(longTag.durationSeconds).toBeGreaterThan(7.5);
  });

  it('scans a full 19 MiB CBR file and rejects over-budget duration before decode', async () => {
    const frameBytes = 1044;
    const frameCount = 18_500;
    const encoded = new Uint8Array(frameBytes * frameCount);
    for (let offset = 0; offset < encoded.length; offset += frameBytes) encoded.set([0xff, 0xfb, 0xe0, 0], offset);
    expect(encoded.byteLength).toBeGreaterThan(16 * 1024 * 1024);
    await expect(inspectAudioBlob(new Blob([toArrayBuffer(encoded)]), options))
      .rejects.toMatchObject({ code: 'duration-too-long' });
  });

  it('accepts PCM16, PCM24, float WAV and FLAC STREAMINFO without relying on file extensions', async () => {
    const pcm16 = await inspectAudioBlob(await fixture('m1-tone-440-mono-44100-pcm16.wav'), options);
    const pcm24 = await inspectAudioBlob(await fixture('m1-tone-440-mono-48000-pcm24.wav'), options);
    const float = await inspectAudioBlob(await fixture('m1-tone-440-mono-48000-float32.wav'), options);
    const flac = await inspectAudioBlob(await fixture('m1-tone-440-mono-44100.flac'), options);
    expect(pcm16).toMatchObject({ format: 'wav', channels: 1, sampleRate: 44_100 });
    expect(pcm24).toMatchObject({ format: 'wav', channels: 1, sampleRate: 48_000 });
    expect(float).toMatchObject({ format: 'wav', channels: 1, sampleRate: 48_000 });
    expect(flac).toMatchObject({ format: 'flac', channels: 1, sampleRate: 44_100 });
    for (const item of [pcm16, pcm24, float, flac]) {
      expect(item.durationSeconds).toBeGreaterThan(7.5);
      expect(item.durationSeconds).toBeLessThan(8.5);
    }
  });

  it('rejects oversized bytes, corrupt single-byte input, and unknown-duration compressed input before decode', async () => {
    let reads = 0;
    const huge = {
      size: options.maxEncodedBytes + 1,
      slice: () => { reads += 1; return new Blob([]); },
    } as unknown as Blob;
    await expect(inspectAudioBlob(huge, options)).rejects.toMatchObject({ code: 'file-too-large' });
    expect(reads).toBe(0);
    await expect(inspectAudioBlob(new Blob([new Uint8Array([0xff])]), options))
      .rejects.toBeInstanceOf(AudioEngineError);
    await expect(inspectAudioBlob(new Blob([toArrayBuffer(longFlacHeader(0))]), options))
      .rejects.toMatchObject({ code: 'duration-too-long' });
  });

  it('rejects MP3 trailing garbage and WAV headers that understate PCM duration', async () => {
    const mp3 = new Uint8Array(await (await fixture('m1-tone-440-mono-44100-cbr.mp3')).arrayBuffer());
    const withGarbage = new Uint8Array(mp3.length + 6);
    withGarbage.set(mp3);
    withGarbage.set([0xde, 0xad, 0xbe, 0xef, 0x13, 0x37], mp3.length);
    await expect(inspectAudioBlob(new Blob([toArrayBuffer(withGarbage)]), options))
      .rejects.toMatchObject({ code: 'corrupt-file' });

    const sampleRate = 48_000;
    const dataBytes = sampleRate * 600 * 2 * 2;
    const wav = new Uint8Array(44);
    const view = new DataView(wav.buffer);
    wav.set(new TextEncoder().encode('RIFF'), 0);
    view.setUint32(4, dataBytes + 36, true);
    wav.set(new TextEncoder().encode('WAVEfmt '), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 8, true);
    view.setUint16(32, 8, true);
    view.setUint16(34, 16, true);
    wav.set(new TextEncoder().encode('data'), 36);
    view.setUint32(40, dataBytes, true);
    await expect(inspectAudioBlob(oversizedBlob(dataBytes + 44, wav), options))
      .rejects.toMatchObject({ code: 'corrupt-file' });

    view.setUint16(32, 4, true);
    view.setUint32(40, dataBytes - 2, true);
    await expect(inspectAudioBlob(oversizedBlob(dataBytes + 44, wav), options))
      .rejects.toMatchObject({ code: 'corrupt-file' });
  });

  it('rejects declared long WAV and FLAC durations before native decode', async () => {
    const sampleRate = 48_000;
    const dataBytes = sampleRate * 600 * 2 * 2;
    const wav = new Uint8Array(44);
    const view = new DataView(wav.buffer);
    wav.set(new TextEncoder().encode('RIFF'), 0);
    view.setUint32(4, dataBytes + 36, true);
    wav.set(new TextEncoder().encode('WAVEfmt '), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    wav.set(new TextEncoder().encode('data'), 36);
    view.setUint32(40, dataBytes, true);
    await expect(inspectAudioBlob(oversizedBlob(dataBytes + 44, wav), options))
      .rejects.toMatchObject({ code: 'duration-too-long' });
    await expect(inspectAudioBlob(new Blob([toArrayBuffer(longFlacHeader(sampleRate * 600))]), options))
      .rejects.toMatchObject({ code: 'duration-too-long' });
    await expect(inspectAudioBlob(await fixture('m1-tone-440-stereo-48000-pcm16.wav'), { ...options, maxDecodedPcmBytes: 1024 }))
      .rejects.toMatchObject({ code: 'file-too-large' });
  });

  describe('MP3 trailing tags, truncated frames and ID3-wrapped FLAC', () => {
    const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);
    const concat = (...parts: Uint8Array[]): Blob => new Blob(parts.map(part => toArrayBuffer(part)));
    const mp3 = async (): Promise<Uint8Array> => new Uint8Array(await (await fixture('m1-tone-440-mono-44100-cbr.mp3')).arrayBuffer());
    const id3v1 = (): Uint8Array => { const tag = new Uint8Array(128); tag.set(ascii('TAG')); return tag; };
    function apeTag(withHeader: boolean): Uint8Array {
      const items = new Uint8Array(24).fill(0x41), block = (header: boolean): Uint8Array => {
        const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
        bytes.set(ascii('APETAGEX'));
        view.setUint32(8, 2000, true);
        view.setUint32(12, items.length + 32, true);
        view.setUint32(16, 1, true);
        view.setUint32(20, (withHeader ? 0x80000000 : 0) | (header ? 0x20000000 : 0), true);
        return bytes;
      };
      const parts = [...(withHeader ? [block(true)] : []), items, block(false)];
      const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of parts) { out.set(part, offset); offset += part.length; }
      return out;
    }
    const lyrics3v1 = (): Uint8Array => ascii('LYRICSBEGINSome words hereLYRICSEND');
    const lyrics3v2 = (): Uint8Array => { const body = 'LYRICSBEGININD0000210'; return ascii(body + String(body.length).padStart(6, '0') + 'LYRICS200'); };

    it('accepts ID3v1, APEv2 (with and without header) and Lyrics3 v1/v2 trailing tags', async () => {
      const audio = await mp3();
      const plain = await inspectAudioBlob(concat(audio), options);
      for (const tail of [[id3v1()], [apeTag(false)], [apeTag(true)], [lyrics3v1()], [lyrics3v2()], [apeTag(true), id3v1()], [lyrics3v2(), apeTag(false), id3v1()]]) {
        const result = await inspectAudioBlob(concat(audio, ...tail), options);
        expect(result).toMatchObject({ format: 'mp3', sampleRate: 44_100 });
        expect(result.durationSeconds).toBe(plain.durationSeconds);
      }
    });

    it('ignores a truncated final frame but still rejects meaningful non-tag garbage', async () => {
      const audio = await mp3();
      const full = await inspectAudioBlob(concat(audio), options);
      const cut = await inspectAudioBlob(concat(audio.subarray(0, audio.length - 100)), options);
      expect(cut.durationSeconds).toBeLessThan(full.durationSeconds!);
      expect(cut.durationSeconds).toBeGreaterThan(full.durationSeconds! - 0.1);
      expect((await inspectAudioBlob(concat(audio.subarray(0, audio.length - 100), id3v1()), options)).durationSeconds).toBe(cut.durationSeconds);
      const garbage = new Uint8Array(4096);
      for (let index = 0; index < garbage.length; index += 1) garbage[index] = (index * 73 + 41) & 0x7f;
      await expect(inspectAudioBlob(concat(audio, garbage), options)).rejects.toMatchObject({ code: 'corrupt-file' });
      await expect(inspectAudioBlob(concat(audio, garbage, id3v1()), options)).rejects.toMatchObject({ code: 'corrupt-file' });
    });

    it('routes FLAC behind an ID3v2 tag to the FLAC parser without the tag', async () => {
      const flac = new Uint8Array(await (await fixture('m1-tone-440-mono-44100.flac')).arrayBuffer());
      const id3 = new Uint8Array(10 + 300);
      id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 2, 0x2c]);
      const result = await inspectAudioBlob(concat(id3, flac), options);
      expect(result).toMatchObject({ format: 'flac', channels: 1, sampleRate: 44_100 });
      expect(result.durationSeconds).toBe((await inspectAudioBlob(concat(flac), options)).durationSeconds);
      expect(new Uint8Array(result.encodedBytes!)).toEqual(flac);
    });
  });
});
