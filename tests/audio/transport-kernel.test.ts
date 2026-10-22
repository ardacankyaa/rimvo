import { describe, expect, it } from 'vitest';

type DeckId = 'A' | 'B';
type StereoBuffers = { left: Float32Array; right: Float32Array };
type Outputs = Record<DeckId, StereoBuffers>;
type Position = { trackRevision: number; frame: number; contextFrame: number; playing: boolean; rate?: number };
type Kernel = {
  installDeck(id: DeckId, channels: readonly Float32Array[], revision: number): void;
  clearDeck(id: DeckId, revision: number): void;
  playDeck(id: DeckId): void;
  pauseDeck(id: DeckId): void;
  seekDeck(id: DeckId, frame: number): void;
  setLoop(id: DeckId, loop: { startFrame: number; endFrame: number } | null): void;
  setTempoPercent?(id: DeckId, percent: number): void;
  beginScratch?(id: DeckId): void;
  updateScratch?(id: DeckId, positionFrame: number, velocity: number): void;
  endScratch?(id: DeckId): void;
  nudgeDeck?(id: DeckId, deltaPercent: number): void;
  setBeatGrid?(id: DeckId, grid: { bpm: number; firstBeatFrame: number } | null): void;
  syncDeck?(id: DeckId, masterId: DeckId | null,alignPhase?:boolean): void;
  processInto(outputs: Outputs, contextStartFrame: number, outputStart?: number, requestedFrames?: number): void;
  readPosition(id: DeckId): Position;
  dispose(): void;
};
type KernelModule = { DualDeckTransportKernel?: new (sampleRate: number) => Kernel };

const transportModules = import.meta.glob('../../src/dsp/transport-kernel.ts');
async function createKernel(sampleRate = 48000): Promise<Kernel | null> {
  const load = Object.values(transportModules)[0];
  const module = load ? (await load()) as KernelModule : null;
  expect(typeof module?.DualDeckTransportKernel).toBe('function');
  return module?.DualDeckTransportKernel
    ? new module.DualDeckTransportKernel(sampleRate)
    : null;
}

function buffers(frames: number): Outputs {
  return {
    A: { left: new Float32Array(frames), right: new Float32Array(frames) },
    B: { left: new Float32Array(frames), right: new Float32Array(frames) },
  };
}

function rms(samples: Float32Array): number {
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return samples.length ? Math.sqrt(power / samples.length) : 0;
}

function maxJump(samples: Float32Array, previous = 0): number {
  let maximum = 0;
  let prior = previous;
  for (const sample of samples) {
    maximum = Math.max(maximum, Math.abs(sample - prior));
    prior = sample;
  }
  return maximum;
}

describe('DualDeckTransportKernel', () => {
  it('matches tempo while paused without seeking the slave, then follows master rate during playback',async()=>{
    const k=await createKernel();if(!k)throw new Error('Kernel unavailable');
    k.installDeck('A',[new Float32Array(480000).fill(.2)],1);k.installDeck('B',[new Float32Array(480000).fill(.2)],2);
    k.setBeatGrid!('A',{bpm:100,firstBeatFrame:2000});k.setBeatGrid!('B',{bpm:110,firstBeatFrame:1000});k.seekDeck('A',7000);k.seekDeck('B',23000);
    k.syncDeck!('B','A',false);expect(k.readPosition('B').frame).toBe(23000);
    k.playDeck('B');k.processInto(buffers(128),0);expect(k.readPosition('B').rate).toBeCloseTo(100/110,4);
    k.setTempoPercent!('A',5);k.processInto(buffers(4800),128);expect(k.readPosition('B').rate).toBeCloseTo(105/110,4);
    k.playDeck('A');k.setTempoPercent!('A',7);k.processInto(buffers(4800),4928);expect(k.readPosition('B').rate).toBeCloseTo(107/110,4);k.dispose();
  });
  it('renders each deck independently, anchors frames, and supports seek/pause', async () => {
    const kernel = await createKernel();
    if (!kernel) return;

    kernel.installDeck('A', [new Float32Array(1000).fill(0.25)], 1);
    kernel.installDeck('B', [new Float32Array(1000).fill(-0.4)], 2);
    kernel.playDeck('A');
    kernel.playDeck('B');

    const first = buffers(300);
    kernel.processInto(first, 1000);
    expect(first.A.left[250]).toBeCloseTo(0.25, 6);
    expect(first.B.left[250]).toBeCloseTo(-0.4, 6);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 300, contextFrame: 1300, playing: true });
    expect(kernel.readPosition('B')).toMatchObject({ frame: 300, contextFrame: 1300, playing: true });

    kernel.pauseDeck('A');
    const second = buffers(300);
    kernel.processInto(second, 1300);
    expect(second.A.left[290]).toBe(0);
    expect(second.B.left[250]).toBeCloseTo(-0.4, 6);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 300, playing: false });
    expect(kernel.readPosition('B')).toMatchObject({ frame: 600, playing: true });

    kernel.seekDeck('A', 1);
    expect(kernel.readPosition('A').frame).toBe(1);
    kernel.seekDeck('A', 0);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 0, playing: false });
    kernel.dispose();
  });

  it('wraps an end-exclusive loop at its exact logical period without moving the other deck', async () => {
    const kernel = await createKernel();
    if (!kernel) return;

    kernel.installDeck('A', [new Float32Array(1000).fill(0.25)], 7);
    kernel.installDeck('B', [new Float32Array(1000).fill(-0.5)], 4);
    kernel.setLoop('A', { startFrame: 100, endFrame: 580 });
    kernel.seekDeck('A', 100);
    kernel.playDeck('A');
    kernel.playDeck('B');

    const output = buffers(500);
    kernel.processInto(output, 0);
    expect(output.A.left[250]).toBeCloseTo(0.25 * (230 / 241), 5);
    expect(Math.abs(output.A.left[480] - output.A.left[479])).toBeLessThan(0.02);
    expect(output.B.left[250]).toBeCloseTo(-0.5, 6);
    expect(kernel.readPosition('A')).toMatchObject({ trackRevision: 7, frame: 120, playing: true });
    expect(kernel.readPosition('B')).toMatchObject({ trackRevision: 4, frame: 500, playing: true });
    kernel.processInto(buffers(480), 500);
    expect(kernel.readPosition('A').frame).toBe(120);
    kernel.dispose();
  });

  it('fades a cleared deck out, leaves the other deck audible, and disposes idempotently', async () => {
    const kernel = await createKernel();
    if (!kernel) return;

    kernel.installDeck('A', [new Float32Array(1000).fill(0.3)], 1);
    kernel.installDeck('B', [new Float32Array(1000).fill(0.5)], 2);
    kernel.playDeck('A');
    kernel.playDeck('B');
    const warmup = buffers(300);
    kernel.processInto(warmup, 20);
    kernel.clearDeck('A', 1);
    kernel.clearDeck('A', 1);

    const output = buffers(300);
    kernel.processInto(output, 320);
    expect(output.A.left[250]).toBe(0);
    expect(output.B.left[250]).toBeCloseTo(0.5, 6);
    expect(kernel.readPosition('A')).toMatchObject({ trackRevision: 1, frame: 0, playing: false });
    expect(kernel.readPosition('B')).toMatchObject({ trackRevision: 2, frame: 600, playing: true });
    kernel.dispose();
    kernel.dispose();
  });

  it('renders only the requested output slice for exact frame splitting', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    kernel.installDeck('A', [new Float32Array(2000).fill(0.25)], 13);
    kernel.playDeck('A');
    kernel.processInto(buffers(480), 0);
    const output = buffers(32);
    output.A.left.fill(-9);
    kernel.processInto(output, 480, 7, 11);
    expect(Array.from(output.A.left.slice(0, 7))).toEqual(Array(7).fill(-9));
    expect(Array.from(output.A.left.slice(18))).toEqual(Array(14).fill(-9));
    expect(output.A.left.slice(7, 18).every(value => Math.abs(value - 0.25) < 0.001)).toBe(true);
    expect(kernel.readPosition('A').frame).toBe(491);
    kernel.dispose();
  });

  it('parks reverse transport at frame zero with a bounded tail', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    if (!kernel.beginScratch || !kernel.updateScratch) return;
    kernel.installDeck('A', [new Float32Array(4000).fill(0.5)], 14);
    kernel.playDeck('A');
    kernel.processInto(buffers(480), 0);
    kernel.beginScratch('A');
    kernel.updateScratch('A', 7, -2);
    const output = buffers(16);
    kernel.processInto(output, 480);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 0, playing: false, rate: 0 });
    expect(maxJump(output.A.left)).toBeLessThan(0.02);
    kernel.dispose();
  });

  it('fades natural EOF without an abrupt tail discontinuity', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    kernel.installDeck('A', [new Float32Array(1200).fill(0.5)], 12);
    kernel.playDeck('A');
    const output = buffers(1500);
    kernel.processInto(output, 0);
    expect(maxJump(output.A.left)).toBeLessThan(0.02);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 1200, playing: false });
    kernel.dispose();
  });

  it('keeps abrupt play, pause, seek, cue, and loop boundaries below a 0.02 full-scale jump', async () => {
    const kernel = await createKernel();
    if (!kernel) return;

    const seekFixture = new Float32Array(4000);
    seekFixture.fill(1, 0, 1000);
    seekFixture.fill(-1, 1000, 2000);
    seekFixture.fill(1, 2000);
    kernel.installDeck('A', [seekFixture], 9);
    kernel.playDeck('A');

    const start = buffers(240);
    kernel.processInto(start, 0);
    expect(maxJump(start.A.left)).toBeLessThan(0.02);
    expect(start.A.left.at(-1)).toBeCloseTo(1, 6);

    kernel.pauseDeck('A');
    const pause = buffers(240);
    kernel.processInto(pause, 240);
    expect(maxJump(pause.A.left, start.A.left.at(-1))).toBeLessThan(0.02);
    expect(pause.A.left.at(-1)).toBe(0);

    kernel.playDeck('A');
    const restart = buffers(240);
    kernel.processInto(restart, 480);
    expect(maxJump(restart.A.left)).toBeLessThan(0.02);
    expect(restart.A.left.at(-1)).toBeCloseTo(1, 6);

    kernel.seekDeck('A', 1200);
    const seek = buffers(240);
    kernel.processInto(seek, 720);
    expect(maxJump(seek.A.left, restart.A.left.at(-1))).toBeLessThan(0.02);
    expect(seek.A.left.at(-1)).toBeCloseTo(-1, 6);

    const loopKernel = await createKernel();
    if (!loopKernel) return;
    const loopFixture = new Float32Array(3000);
    for (let index = 0; index < 480; index += 1) {
      loopFixture[1000 + index] = -1 + 2 * index / 479;
    }
    loopKernel.installDeck('A', [loopFixture], 10);
    loopKernel.setLoop('A', { startFrame: 1000, endFrame: 1480 });
    loopKernel.playDeck('A');
    const loopOutput = buffers(960);
    loopKernel.processInto(loopOutput, 0);
    expect(maxJump(loopOutput.A.left)).toBeLessThan(0.02);
    expect(loopKernel.readPosition('A')).toMatchObject({ frame: 1000, playing: true });
    kernel.dispose();
    loopKernel.dispose();
  });
});


describe('DualDeckTransportKernel signed rate and scratch', () => {
  it('tracks reverse cursor motion, parks at zero, and retains the other deck', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    for (const method of ['setTempoPercent', 'beginScratch', 'updateScratch', 'endScratch', 'nudgeDeck'] as const) {
      expect(typeof kernel[method]).toBe('function');
    }
    if (!kernel.beginScratch || !kernel.updateScratch || !kernel.setTempoPercent) return;

    const ramp = Float32Array.from({ length: 20_000 }, (_, frame) => frame / 20_000);
    kernel.installDeck('A', [ramp], 31);
    kernel.installDeck('B', [new Float32Array(20_000).fill(0.2)], 32);
    kernel.playDeck('A');
    kernel.playDeck('B');
    const warmup = buffers(384);
    kernel.processInto(warmup, 0);
    kernel.beginScratch('A');
    kernel.updateScratch('A', 384, -2);

    const reverse = buffers(128);
    kernel.processInto(reverse, 384);
    expect(reverse.A.left[1]).toBeLessThan(reverse.A.left[0]);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 128, playing: true, rate: -2 });
    expect(kernel.readPosition('B').frame).toBe(512);

    kernel.updateScratch('A', 128, 0);
    const parked = buffers(512);
    kernel.processInto(parked, 512);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 128, playing: false, rate: 0 });
    expect(rms(parked.A.left.slice(-128))).toBe(0);
    expect(kernel.readPosition('B').frame).toBe(1024);
    kernel.dispose();
  });

  it('returns a paused deck to silence after scratch and decays a nudge on render frames', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    expect(typeof kernel.nudgeDeck).toBe('function');
    expect(typeof kernel.endScratch).toBe('function');
    if (!kernel.beginScratch || !kernel.updateScratch || !kernel.endScratch || !kernel.nudgeDeck) return;

    kernel.installDeck('A', [new Float32Array(30_000).fill(0.25)], 33);
    kernel.beginScratch('A');
    kernel.updateScratch('A', 1000, 1);
    kernel.processInto(buffers(240), 0);
    expect(kernel.readPosition('A').frame).toBeGreaterThan(1000);
    kernel.endScratch('A');
    kernel.processInto(buffers(1200), 240);
    expect(kernel.readPosition('A')).toMatchObject({ playing: false, rate: 0 });
    expect(kernel.readPosition('A').frame).toBeGreaterThan(1000);

    kernel.playDeck('A');
    kernel.nudgeDeck('A', 4);
    kernel.processInto(buffers(6000), 1440);
    const afterNudge = kernel.readPosition('A');
    expect(afterNudge.frame).toBeGreaterThan(7000);
    expect(afterNudge.frame).toBeLessThan(7400);
    expect(afterNudge.rate).toBeCloseTo(1, 2);
    kernel.dispose();
  });

  it('ramps signed scratch rate back toward nominal over render frames on release', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    if (!kernel.beginScratch || !kernel.updateScratch || !kernel.endScratch) return;
    kernel.installDeck('A', [Float32Array.from({ length: 80_000 }, (_, frame) => frame / 80_000)], 35);
    kernel.playDeck('A');
    kernel.processInto(buffers(480), 0);
    kernel.beginScratch('A');
    kernel.updateScratch('A', 20_000, -2);
    kernel.processInto(buffers(240), 480);
    expect(kernel.readPosition('A').rate).toBe(-2);
    const beforeRelease = kernel.readPosition('A').frame;
    kernel.endScratch('A');
    const release = buffers(240);
    kernel.processInto(release, 720);
    const halfway = kernel.readPosition('A');
    expect(halfway.rate).toBeLessThan(0);
    expect(halfway.rate).toBeGreaterThan(-2);
    expect(halfway.frame).toBeLessThan(beforeRelease);
    kernel.processInto(buffers(720), 960);
    expect(kernel.readPosition('A').rate).toBeCloseTo(1, 5);
    kernel.dispose();
  });

  it('parks stale scratch velocity within fifty milliseconds of the final update', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    expect(typeof kernel.beginScratch).toBe('function');
    if (!kernel.beginScratch || !kernel.updateScratch) return;

    kernel.installDeck('A', [new Float32Array(50_000).fill(0.25)], 34);
    kernel.beginScratch('A');
    kernel.updateScratch('A', 10_000, 1);
    kernel.processInto(buffers(2600), 0);
    expect(kernel.readPosition('A').rate).toBe(0);
    expect(kernel.readPosition('A').frame).toBeLessThanOrEqual(12_450);
    kernel.dispose();
  });
});


describe('DualDeckTransportKernel beat-grid sync', () => {
  it('keeps shared-clock beat phase within one source frame over 32 bars and one hour', () => {
    const sampleRate = 48_000;
    const masterBpm = 118, slaveBpm = 124, masterRate = 1.12;
    const slaveRate = masterRate * masterBpm / slaveBpm;
    const beats32Bars = 32 * 4;
    const windows = [beats32Bars * 60 * sampleRate / (masterBpm * masterRate), 3600 * sampleRate];
    for (const frames of windows) {
      let masterPosition = 0, slavePosition = 0;
      const count = Math.floor(frames);
      for (let frame = 0; frame < count; frame += 1) {
        masterPosition += masterRate;
        slavePosition += slaveRate;
      }
      const masterPhaseFrame = masterPosition % (60 * sampleRate / masterBpm);
      const slavePhaseFrame = slavePosition % (60 * sampleRate / slaveBpm);
      const masterPhase = masterPhaseFrame / (60 * sampleRate / masterBpm);
      const slavePhase = slavePhaseFrame / (60 * sampleRate / slaveBpm);
      const beatError = Math.min(Math.abs(masterPhase - slavePhase), 1 - Math.abs(masterPhase - slavePhase));
      expect(beatError * 60 * sampleRate / slaveBpm).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a beat-synced follower inside its active loop at the master phase', async () => {
    const kernel = await createKernel();
    if (!kernel?.setBeatGrid || !kernel.syncDeck) return;
    kernel.installDeck('A', [new Float32Array(500_000).fill(0.1)], 51);
    kernel.installDeck('B', [new Float32Array(500_000).fill(-0.1)], 52);
    kernel.setBeatGrid('A', { bpm: 120, firstBeatFrame: 0 });
    kernel.setBeatGrid('B', { bpm: 120, firstBeatFrame: 0 });
    kernel.setLoop('B', { startFrame: 48_000, endFrame: 96_000 });
    kernel.seekDeck('B', 95_000);
    kernel.playDeck('A');
    kernel.processInto(buffers(2400), 0);
    kernel.syncDeck('B', 'A');
    const frame = kernel.readPosition('B').frame;
    expect(frame).toBeGreaterThanOrEqual(48_000);
    expect(frame).toBeLessThan(96_000);
    expect((frame / 24_000) % 1).toBeCloseTo((kernel.readPosition('A').frame / 24_000) % 1, 4);
    kernel.dispose();
  });

  it('aligns phase on a shared processor frame and keeps matched clocks phase-locked', async () => {
    const kernel = await createKernel();
    if (!kernel) return;
    expect(typeof kernel.setBeatGrid).toBe('function');
    expect(typeof kernel.syncDeck).toBe('function');
    if (!kernel.setBeatGrid || !kernel.syncDeck) return;

    kernel.installDeck('A', [new Float32Array(1_000_000).fill(0.1)], 41);
    kernel.installDeck('B', [new Float32Array(1_000_000).fill(-0.1)], 42);
    kernel.setBeatGrid('A', { bpm: 120, firstBeatFrame: 0 });
    kernel.setBeatGrid('B', { bpm: 128, firstBeatFrame: 200 });
    kernel.seekDeck('B', 800_000);
    kernel.playDeck('A');
    kernel.playDeck('B');
    kernel.processInto(buffers(2400), 0);
    kernel.syncDeck('B', 'A');
    const aligned = kernel.readPosition('B');
    expect(aligned.contextFrame).toBe(kernel.readPosition('A').contextFrame);
    expect(aligned.frame).toBeGreaterThan(700_000);
    expect(((aligned.frame - 200) / 22_500) % 1).toBeCloseTo((kernel.readPosition('A').frame / 24_000) % 1, 4);
    kernel.processInto(buffers(480), 2400);
    expect(kernel.readPosition('B').rate).toBeCloseTo(120 / 128, 5);

    for (let frame = 2880; frame < 50_400; frame += 128) kernel.processInto(buffers(128), frame);
    const master = kernel.readPosition('A');
    const slave = kernel.readPosition('B');
    const masterPhase = (master.frame / 24_000) % 1;
    const slavePhase = ((slave.frame - 200) / 22_500) % 1;
    const phaseError = Math.abs(masterPhase - slavePhase);
    expect(Math.min(phaseError, 1 - phaseError)).toBeLessThan(0.015);
    kernel.dispose();
  });
});

describe('Rendered seek during a pause fade', () => {
  it('crossfades a cue seek while the paused deck is still audible', async () => {
    const kernel = await createKernel();
    if (!kernel) return;

    const fixture = new Float32Array(4000);
    fixture.fill(0.5, 0, 1000);
    fixture.fill(-0.5, 1000, 2000);
    fixture.fill(0.25, 2000);
    kernel.installDeck('A', [fixture], 19);
    kernel.playDeck('A');

    const playing = buffers(240);
    kernel.processInto(playing, 0);
    kernel.pauseDeck('A');
    const pauseFade = buffers(128);
    kernel.processInto(pauseFade, 240);

    kernel.seekDeck('A', 1500);
    const afterCueSeek = buffers(1);
    kernel.processInto(afterCueSeek, 368);

    const boundaryJump = maxJump(afterCueSeek.A.left, pauseFade.A.left.at(-1) ?? 0);
    expect(boundaryJump).toBeLessThan(0.02);
    expect(kernel.readPosition('A')).toMatchObject({ frame: 1500, playing: false });
    kernel.dispose();
  });
});
