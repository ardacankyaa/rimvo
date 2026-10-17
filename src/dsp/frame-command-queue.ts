/** Small stable frame queue for commands that must be applied by the render clock. */
export class FrameCommandQueue<T extends { readonly applyFrame: number }> {
  private readonly items: T[] = [];

  constructor(private readonly capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('Queue capacity must be a positive safe integer.');
  }

  get size(): number { return this.items.length; }

  peek(): T | undefined { return this.items[0]; }

  enqueue(command: T): boolean {
    if (!Number.isSafeInteger(command.applyFrame) || command.applyFrame < 0) throw new RangeError('Scheduled frame must be a nonnegative safe integer.');
    if (this.items.length >= this.capacity) return false;
    let index = this.items.length;
    while (index > 0 && this.items[index - 1].applyFrame > command.applyFrame) index -= 1;
    this.items.splice(index, 0, command);
    return true;
  }

  shift(): T | undefined { return this.items.shift(); }

  removeIf(predicate: (command: T) => boolean): T[] {
    const removed: T[] = [];
    let write = 0;
    for (let read = 0; read < this.items.length; read += 1) {
      const item = this.items[read];
      if (predicate(item)) removed.push(item);
      else this.items[write++] = item;
    }
    this.items.length = write;
    return removed;
  }

  clear(): T[] {
    const removed = this.items.slice();
    this.items.length = 0;
    return removed;
  }
}
