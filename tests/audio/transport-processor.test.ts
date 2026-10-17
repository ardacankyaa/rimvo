import { describe, expect, it, vi } from 'vitest';
import type { TransportCommand, TransportProcessorMessage } from '../../src/audio/protocol';

type WorkletProcessor = {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

describe('DualDeckTransportProcessor interruption handling', () => {
  it('cancels future commands but preserves an in-progress clear until its fade ACK', async () => {
    const messages: TransportProcessorMessage[] = [];
    const port = {
      onmessage: null as ((event: MessageEvent<TransportCommand>) => void) | null,
      postMessage(message: TransportProcessorMessage): void { messages.push(message); },
    };
    let registered: (new () => WorkletProcessor) | null = null;
    vi.stubGlobal('AudioWorkletProcessor', class { readonly port = port as unknown as MessagePort; });
    vi.stubGlobal('registerProcessor', (_name: string, processor: new () => WorkletProcessor) => { registered = processor; });
    vi.stubGlobal('sampleRate', 48_000);
    vi.stubGlobal('currentFrame', 0);
    vi.resetModules();

    try {
      await import('../../src/audio/transport-processor');
      expect(registered).not.toBeNull();
      const processor = new registered!();
      const send = (command: TransportCommand): void => port.onmessage?.({ data: command } as MessageEvent<TransportCommand>);
      let currentFrameValue = 0;
      const render = (blockCount: number): { leftA: Float32Array; leftB: Float32Array } => {
        const leftA = new Float32Array(blockCount * 128);
        const leftB = new Float32Array(blockCount * 128);
        for (let block = 0; block < blockCount; block += 1) {
          const outputA = [new Float32Array(128), new Float32Array(128)];
          const outputB = [new Float32Array(128), new Float32Array(128)];
          processor.process([], [outputA, outputB]);
          leftA.set(outputA[0], block * 128);
          leftB.set(outputB[0], block * 128);
          currentFrameValue += 128;
          vi.stubGlobal('currentFrame', currentFrameValue);
        }
        return { leftA, leftB };
      };

      send({ type: 'install', commandId: 1, requestedFrame: 0, deckId: 'A', trackRevision: 1, channels: [new Float32Array(2_048).fill(0.25)] });
      send({ type: 'install', commandId: 2, requestedFrame: 0, deckId: 'B', trackRevision: 3, channels: [new Float32Array(2_048).fill(-0.35)] });
      render(1);
      send({type:'transport-pair',applyFrame:0,commands:[
        { type:'play',commandId:3,requestedFrame:0,deckId:'A',trackRevision:1 },
        { type:'play',commandId:4,requestedFrame:0,deckId:'B',trackRevision:3 },
      ]});
      const shared=messages.filter(message=>message.type==='ack'&&(message.ack.commandId===3||message.ack.commandId===4));
      expect(shared).toHaveLength(2);
      expect(shared.every(message=>message.type==='ack'&&message.ack.appliedFrame===128&&message.ack.lateFrames===128)).toBe(true);
      // A replacement cancels both halves; the remaining deck must keep playing.
      send({type:'transport-pair',applyFrame:512,commands:[
        {type:'pause',commandId:20,requestedFrame:512,deckId:'A',trackRevision:1},
        {type:'pause',commandId:21,requestedFrame:512,deckId:'B',trackRevision:3},
      ]});
      send({type:'install',commandId:22,requestedFrame:128,deckId:'A',trackRevision:2,channels:[new Float32Array(2048).fill(.25)]});
      expect(messages).toContainEqual(expect.objectContaining({type:'error',commandId:20,code:'stale-load'}));
      expect(messages).toContainEqual(expect.objectContaining({type:'error',commandId:21,code:'stale-load'}));
      send({type:'install',commandId:23,requestedFrame:128,deckId:'A',trackRevision:1,channels:[new Float32Array(2048).fill(.25)]});
      send({type:'play',commandId:24,requestedFrame:128,deckId:'A',trackRevision:1});
      render(4);

      send({ type: 'tempo', commandId: 5, requestedFrame: currentFrameValue, applyFrame: currentFrameValue + 256, deckId: 'A', trackRevision: 1, tempoPercent: 4 });
      send({ type: 'cancel-scheduled', reason: 'context-interrupted' });
      expect(messages).toContainEqual(expect.objectContaining({ type: 'error', commandId: 5, code: 'context-interrupted' }));

      send({ type: 'clear', commandId: 6, requestedFrame: currentFrameValue, deckId: 'A', trackRevision: 1 });
      expect(messages.some(message => message.type === 'ack' && message.ack.commandId === 6)).toBe(false);
      send({ type: 'cancel-scheduled', reason: 'context-interrupted' });
      expect(messages.some(message => message.type === 'ack' && message.ack.commandId === 6)).toBe(false);

      const afterFade = render(4);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'ack', ack: expect.objectContaining({ commandId: 6 }) }));
      expect(afterFade.leftA.slice(-128).every(sample => sample === 0)).toBe(true);
      expect(afterFade.leftB.slice(-128).some(sample => Math.abs(sample) > 0.1)).toBe(true);
      render(6);
      const snapshot = messages.filter((message): message is Extract<TransportProcessorMessage, { type: 'snapshot' }> => message.type === 'snapshot').at(-1);
      expect(snapshot?.positions.B).toMatchObject({ trackRevision: 3, playing: true });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
