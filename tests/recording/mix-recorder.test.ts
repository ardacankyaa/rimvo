import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixRecorder } from '../../src/recording/mix-recorder';
import type { CaptureMessage } from '../../src/recording/types';
import { encodeRecordingWav } from '../../src/recording/wav';

class FakeWorklet {
  static instances: FakeWorklet[] = [];
  readonly listeners = new Map<string, () => void>();
  readonly port = { onmessage: null as ((event: MessageEvent<CaptureMessage>) => void) | null, postMessage: vi.fn(), close: vi.fn() };
  readonly connect = vi.fn(); readonly disconnect = vi.fn();
  constructor() { FakeWorklet.instances.push(this); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  removeEventListener(event: string) { this.listeners.delete(event); }
  emit(message: CaptureMessage) { this.port.onmessage?.({ data: message } as MessageEvent<CaptureMessage>); }
}
function fixture() {
  vi.stubGlobal('AudioWorkletNode', FakeWorklet);
  const source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
  const context = { sampleRate: 48000, state: 'running', audioWorklet: { addModule: vi.fn(async () => undefined) }, destination: {} } as unknown as AudioContext;
  const recorder = new MixRecorder();
  return { source, context, recorder };
}
afterEach(() => { FakeWorklet.instances = []; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('recording lifecycle ownership', () => {
  it('restores a stopped WAV exactly and rejects invalid or active replacements', async () => {
    const { recorder, context, source } = fixture();
    const wav = encodeRecordingWav([new Int16Array([100, -100, 200, -200])], 48000);
    await recorder.restore(wav);
    expect(recorder.getSnapshot()).toMatchObject({ status: 'ready', bytes: 8, sampleRate: 48000, durationSeconds: 2 / 48000 });
    expect(recorder.export()).toBe(wav);
    const invalid = new Blob([new Uint8Array(48)]);
    await expect(recorder.restore(invalid)).rejects.toThrow('supported stereo WAV');
    expect(recorder.export()).toBe(wav);
    await recorder.start(context, source);
    await expect(recorder.restore(wav)).rejects.toThrow('Stop the recording');
    expect(recorder.getSnapshot().status).toBe('recording');
    recorder.dispose();
  });
  it('stops after final chunk ACK, caches exports and disconnects only its own tap', async () => {
    const { source, context, recorder } = fixture();
    await recorder.start(context, source);
    const node = FakeWorklet.instances[0];
    expect(recorder.getSnapshot().maxDurationSeconds).toBeCloseTo(128 * 1024 * 1024 / 4 / 48000);
    node.emit({ type: 'chunk', samples: new Int16Array([120, -120]) });
    const stop = recorder.stop(); expect(recorder.getSnapshot().status).toBe('stopping');
    node.emit({ type: 'chunk', samples: new Int16Array([240, -240]) });
    node.emit({ type: 'stopped', reason: 'manual' });
    const ready = await stop; expect(ready.bytes).toBe(8); expect(ready.durationSeconds).toBe(2 / 48000);
    expect(source.disconnect).toHaveBeenCalledWith(node);
    expect(source.disconnect).not.toHaveBeenCalledWith();
    expect(recorder.export()).toBe(recorder.export()); expect(recorder.export().size).toBe(52);
    recorder.clear(); expect(recorder.getSnapshot().status).toBe('idle'); expect(() => recorder.export()).toThrow();
    recorder.dispose();
  });
  it('flushes an interrupted take and prevents stale/disposed callbacks', async () => {
    const { context, source, recorder } = fixture(); await recorder.start(context, source);
    const node = FakeWorklet.instances[0]; node.emit({ type: 'chunk', samples: new Int16Array([12, -12]) });
    recorder.interrupt(); expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'stop', reason: 'interrupted' });
    node.emit({ type: 'stopped', reason: 'interrupted' });
    expect(recorder.getSnapshot().status).toBe('ready'); expect(recorder.getSnapshot().stopReason).toBe('interrupted');
    expect(recorder.export().size).toBe(48);
    await recorder.start(context, source); const current = FakeWorklet.instances[1]; const pending = recorder.stop();
    recorder.dispose(); expect((await pending).status).toBe('idle');
    expect(current.port.onmessage).toBe(null); expect(current.port.close).toHaveBeenCalledOnce();
    expect(() => recorder.export()).toThrow();
  });
  it('reports truncated capture explicitly when the worklet cannot ACK stop', async () => {
    vi.useFakeTimers(); const { context, source, recorder } = fixture(); await recorder.start(context, source);
    FakeWorklet.instances[0].emit({ type: 'chunk', samples: new Int16Array([10, -10]) });
    const stop = recorder.stop(); await vi.advanceTimersByTimeAsync(3000);
    expect((await stop).status).toBe('error'); expect(recorder.getSnapshot().error).toContain('captured portion');
    expect(recorder.getSnapshot().durationSeconds).toBe(1 / 48000); expect(recorder.export().size).toBe(48);
    recorder.dispose();
  });
  it('cancels async preparation on interruption without attaching a stale node', async () => {
    const { context, source, recorder } = fixture(); let release!: () => void;
    context.audioWorklet.addModule = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const start = recorder.start(context, source); expect(recorder.getSnapshot().status).toBe('preparing');
    recorder.interrupt(); release(); await expect(start).rejects.toThrow('interrupted');
    expect(FakeWorklet.instances).toHaveLength(0); expect(source.connect).not.toHaveBeenCalled();
    expect(recorder.getSnapshot().status).toBe('idle'); recorder.dispose();
  });
});
