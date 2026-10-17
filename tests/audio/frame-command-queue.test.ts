import { describe, expect, it } from 'vitest';
import { FrameCommandQueue } from '../../src/dsp/frame-command-queue';

type Command = { readonly id: number; readonly applyFrame: number; readonly deckId: 'A' | 'B' };

describe('FrameCommandQueue', () => {
  it('orders exact frames stably so paired deck commands share one render boundary', () => {
    const queue = new FrameCommandQueue<Command>(256);
    queue.enqueue({ id: 2, deckId: 'B', applyFrame: 137 });
    queue.enqueue({ id: 1, deckId: 'A', applyFrame: 137 });
    queue.enqueue({ id: 3, deckId: 'A', applyFrame: 256 });
    expect(queue.peek()?.id).toBe(2);
    expect(queue.shift()?.id).toBe(2);
    expect(queue.peek()?.id).toBe(1);
    expect(queue.shift()?.id).toBe(1);
    expect(queue.peek()?.applyFrame).toBe(256);
  });

  it('bounds future commands at 256 and reports overflow without mutating the queue', () => {
    const queue = new FrameCommandQueue<Command>(256);
    for (let id = 0; id < 256; id += 1) expect(queue.enqueue({ id, deckId: 'A', applyFrame: id + 1000 })).toBe(true);
    expect(queue.enqueue({ id: 256, deckId: 'B', applyFrame: 500 })).toBe(false);
    expect(queue.size).toBe(256);
  });

  it('cancels every scheduled command for a replaced deck while keeping the other deck ordered', () => {
    const queue = new FrameCommandQueue<Command>(256);
    queue.enqueue({ id: 1, deckId: 'A', applyFrame: 10 });
    queue.enqueue({ id: 2, deckId: 'B', applyFrame: 20 });
    queue.enqueue({ id: 3, deckId: 'A', applyFrame: 30 });
    expect(queue.removeIf(command => command.deckId === 'A').map(command => command.id)).toEqual([1, 3]);
    expect(queue.size).toBe(1);
    expect(queue.shift()?.id).toBe(2);
  });
});
