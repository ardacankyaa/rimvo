import { describe, expect, it } from 'vitest';
import { encodeRecordingMp3 } from '../../src/recording/mp3';
import { encodeRecordingWav } from '../../src/recording/wav';

describe('MP3 recording export', () => {
  it.each([44100, 48000, 96000])('encodes a stereo %i Hz take into MPEG Layer III frames without modifying the WAV', async sampleRate => {
    const samples = new Int16Array(sampleRate * 2);
    for (let frame = 0; frame < sampleRate; frame++) {
      samples[frame * 2] = Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 16000);
      samples[frame * 2 + 1] = Math.round(Math.sin(2 * Math.PI * 880 * frame / sampleRate) * 8000);
    }
    const wav = await encodeRecordingWav([samples.subarray(0, 8192), samples.subarray(8192)], sampleRate).arrayBuffer();
    const original = wav.slice(0);
    const progress: number[] = [];
    const mp3 = encodeRecordingMp3(wav, percent => progress.push(percent));
    const bytes = new Uint8Array(await mp3.arrayBuffer());
    expect(mp3.type).toBe('audio/mpeg');
    expect(mp3.size).toBeGreaterThan(1000);
    expect(mp3.size).toBeLessThan(wav.byteLength);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0); // MPEG frame sync
    expect((bytes[1] >> 1) & 3).toBe(1); // Layer III
    expect(bytes[3] >> 6).not.toBe(3); // Stereo, not mono
    expect(new Uint8Array(wav)).toEqual(new Uint8Array(original));
    expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress).toEqual([...new Set(progress)].sort((a, b) => a - b));
  });

  it('flushes even a take shorter than one MP3 frame', async () => {
    const mp3 = encodeRecordingMp3(await encodeRecordingWav([new Int16Array([100, -100])], 48000).arrayBuffer());
    expect(mp3.type).toBe('audio/mpeg');
    expect(mp3.size).toBeGreaterThan(0);
  });
});
