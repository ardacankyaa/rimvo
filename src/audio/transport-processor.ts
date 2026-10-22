import {
  DualDeckTransportKernel,
  type DualTransportOutputs,
} from '../dsp/transport-kernel';
import { FrameCommandQueue } from '../dsp/frame-command-queue';
import type { CommandAck, DeckId } from './types';
import type { AckableTransportCommand, TransportCommand, TransportProcessorMessage, TransportPair } from './protocol';

const deckIds: readonly DeckId[] = ['A', 'B'];
type ScheduledCommand = (AckableTransportCommand | TransportPair) & { readonly applyFrame: number };

class DualDeckTransportProcessor extends AudioWorkletProcessor {
  private readonly kernel = new DualDeckTransportKernel(sampleRate);
  private readonly outputBridge: {
    A: { left: Float32Array; right: Float32Array };
    B: { left: Float32Array; right: Float32Array };
  } = {
    A: { left: new Float32Array(0), right: new Float32Array(0) },
    B: { left: new Float32Array(0), right: new Float32Array(0) },
  };
  private readonly pendingClear: Record<DeckId, AckableTransportCommand | null> = { A: null, B: null };
  private readonly scheduled = new FrameCommandQueue<ScheduledCommand>(256);
  private nextSnapshotFrame = Math.round(sampleRate / 30);
  private disposed = false;
  private faulted = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<TransportCommand>) => this.handleCommand(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed || this.faulted) {
      this.zeroOutputs(outputs);
      return !this.disposed;
    }
    const outputA = outputs[0];
    const outputB = outputs[1];
    if (!outputA?.[0] || !outputB?.[0]) {
      this.fail('Transport processor received an incomplete two-output block.');
      this.zeroOutputs(outputs);
      return false;
    }
    this.outputBridge.A.left = outputA[0];
    this.outputBridge.A.right = outputA[1] ?? outputA[0];
    this.outputBridge.B.left = outputB[0];
    this.outputBridge.B.right = outputB[1] ?? outputB[0];
    try {
      this.renderQuantum(this.outputBridge as DualTransportOutputs, currentFrame, outputA[0].length);
      for (const deckId of deckIds) {
        const pending = this.pendingClear[deckId];
        if (pending && !this.kernel.hasDeck(deckId)) {
          this.pendingClear[deckId] = null;
          this.postAck(pending, this.kernel.getClearAppliedFrame(deckId));
        }
      }
      if (currentFrame >= this.nextSnapshotFrame) {
        this.port.postMessage({
          type: 'snapshot',
          contextFrame: currentFrame + outputA[0].length,
          positions: { A: this.kernel.readPosition('A'), B: this.kernel.readPosition('B') },
        } satisfies TransportProcessorMessage);
        this.nextSnapshotFrame = currentFrame + Math.max(1, Math.round(sampleRate / 30));
      }
      return true;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Transport processor failed.');
      this.zeroOutputs(outputs);
      return false;
    }
  }

  private renderQuantum(outputs: DualTransportOutputs, blockStart: number, blockLength: number): void {
    const blockEnd = blockStart + blockLength;
    let offset = 0;
    while (this.scheduled.peek() && this.scheduled.peek()!.applyFrame <= blockEnd) {
      const head = this.scheduled.peek()!;
      const target = Math.max(blockStart + offset, Math.min(blockEnd, head.applyFrame));
      const targetOffset = target - blockStart;
      if (targetOffset > offset) {
        this.kernel.processInto(outputs, blockStart + offset, offset, targetOffset - offset);
        offset = targetOffset;
      }
      const appliedFrame = blockStart + offset;
      while (this.scheduled.peek() && this.scheduled.peek()!.applyFrame <= appliedFrame) {
        const command = this.scheduled.shift()!;
        this.applyScheduled(command,appliedFrame);
      }
    }
    if (offset < blockLength) this.kernel.processInto(outputs, blockStart + offset, offset, blockLength - offset);
  }

  private handleCommand(command: TransportCommand): void {
    if (command.type === 'dispose') {
      this.cancelScheduled('disposed', 'Transport processor was disposed.');
      this.kernel.dispose();
      this.disposed = true;
      return;
    }
    if (command.type === 'cancel-scheduled') {
      const reason = command.reason ?? 'context-interrupted';
      this.cancelScheduled(reason, reason === 'disposed' ? 'Audio context was disposed.' : 'Audio context was suspended.');
      return;
    }
    if (command.type === 'release-scratch') {
      this.kernel.endScratch('A');
      this.kernel.endScratch('B');
      return;
    }
    if(command.type==='release-nudge'){
      if(!this.disposed&&!this.faulted){this.kernel.holdNudge('A',0);this.kernel.holdNudge('B',0);}return;
    }
    if (this.disposed || this.faulted) return;
    if(command.type==='transport-pair'){
      if(command.applyFrame>currentFrame){if(!this.scheduled.enqueue(command))this.rejectScheduled(command,'queue-full','The scheduled audio command queue is full.');}
      else this.applyScheduled(command,currentFrame);
      return;
    }
    if (command.type === 'scratch-update' || command.type === 'grid') {
      if (this.pendingClear[command.deckId]) return;
      const current = this.kernel.readPosition(command.deckId);
      if (current.trackRevision !== command.trackRevision) return;
      try {
        if (command.type === 'scratch-update') this.kernel.updateScratch(command.deckId, command.positionFrame, command.velocity);
        else this.kernel.setBeatGrid(command.deckId, command.grid);
      } catch { /* Continuous input and grid settings are bounded at the public engine boundary. */ }
      return;
    }
    if (this.pendingClear[command.deckId]) {
      this.postError(command, 'queue-full', 'A deck transition is still fading out.');
      return;
    }
    if (command.type === 'install' || command.type === 'clear') this.cancelScheduledDeck(command.deckId);
    if (command.type !== 'install') {
      const current = this.kernel.readPosition(command.deckId);
      if (current.trackRevision !== command.trackRevision) {
        this.postError(command, 'stale-load', 'Command belongs to an older track revision.');
        return;
      }
    }
    if ('applyFrame' in command && command.applyFrame !== undefined && command.applyFrame > currentFrame) {
      if (!this.scheduled.enqueue(command as ScheduledCommand)) this.postError(command, 'queue-full', 'The scheduled audio command queue is full.');
      return;
    }
    this.applyCommand(command, currentFrame);
  }

  private cancelScheduledDeck(deckId: DeckId): void {
    const cancelled = this.scheduled.removeIf(command => command.type==='transport-pair'?command.commands.some(item=>item.deckId===deckId):command.deckId === deckId);
    for (const command of cancelled) this.rejectScheduled(command, 'stale-load', 'Scheduled command was cancelled by a deck replacement.');
  }

  private cancelScheduled(code: 'context-interrupted' | 'disposed', message: string): void {
    for (const command of this.scheduled.clear()) this.rejectScheduled(command, code, message);
  }

  private rejectScheduled(command:ScheduledCommand,code:'stale-load'|'queue-full'|'context-interrupted'|'disposed',message:string):void {
    for(const item of command.type==='transport-pair'?command.commands:[command])this.postError(item,code,message);
  }

  private applyScheduled(command:ScheduledCommand,frame:number):void {
    const commands=command.type==='transport-pair'?command.commands:[command];
    for(const item of commands){
      if(this.pendingClear[item.deckId]){this.rejectScheduled(command,'queue-full','A deck transition is still fading out.');return;}
      if(this.kernel.readPosition(item.deckId).trackRevision!==item.trackRevision){this.rejectScheduled(command,'stale-load','Scheduled command belongs to an older track revision.');return;}
    }
    // Both decks arrive and validate in one worklet event, even if the requested frame is late.
    for(const item of commands)this.applyCommand(item,frame);
  }

  private applyCommand(command: AckableTransportCommand, appliedFrame: number): void {
    try {
      switch (command.type) {
        case 'install':
          this.kernel.installDeck(command.deckId, command.channels, command.trackRevision);
          this.postAck(command, appliedFrame);
          return;
        case 'clear': {
          const completed = this.kernel.clearDeck(command.deckId, command.trackRevision);
          if (completed) this.postAck(command, this.kernel.getClearAppliedFrame(command.deckId));
          else this.pendingClear[command.deckId] = command;
          return;
        }
        case 'play': this.kernel.playDeck(command.deckId); this.postAck(command, appliedFrame); return;
        case 'pause': this.kernel.pauseDeck(command.deckId); this.postAck(command, appliedFrame); return;
        case 'seek': this.kernel.seekDeck(command.deckId, command.mediaFrame); this.postAck(command, appliedFrame); return;
        case 'loop': this.kernel.setLoop(command.deckId, command.loop); this.postAck(command, appliedFrame); return;
        case 'tempo': this.kernel.setTempoPercent(command.deckId, command.tempoPercent); this.postAck(command, appliedFrame); return;
        case 'scratch-begin': this.kernel.beginScratch(command.deckId); this.postAck(command, appliedFrame); return;
        case 'scratch-end': this.kernel.endScratch(command.deckId); this.postAck(command, appliedFrame); return;
        case 'nudge': this.kernel.nudgeDeck(command.deckId, command.deltaPercent); this.postAck(command, appliedFrame); return;
        case 'nudge-hold': this.kernel.holdNudge(command.deckId, command.deltaPercent); this.postAck(command, appliedFrame); return;
        case 'sync': this.kernel.syncDeck(command.deckId, command.masterId,command.alignPhase??true); this.postAck(command, appliedFrame); return;
      }
    } catch (error) {
      this.postError(command, error instanceof RangeError ? 'invalid-value' : 'internal', error instanceof Error ? error.message : 'Transport command failed.');
    }
  }

  private postAck(command: AckableTransportCommand, appliedFrame: number): void {
    const lateFrames = Math.max(0, appliedFrame - command.requestedFrame);
    const ack: CommandAck = {
      commandId: command.commandId, trackRevision: command.trackRevision,
      requestedFrame: command.requestedFrame, appliedFrame, lateFrames,
      outcome: lateFrames > 0 ? 'late' : 'applied',
    };
    const position = this.kernel.readPosition(command.deckId);
    this.port.postMessage({ type: 'ack', ack, position: { ...position, contextFrame: appliedFrame } } satisfies TransportProcessorMessage);
  }

  private postError(
    command: AckableTransportCommand,
    code: 'stale-load' | 'queue-full' | 'invalid-value' | 'context-interrupted' | 'disposed' | 'internal',
    message: string,
  ): void {
    this.port.postMessage({ type: 'error', commandId: command.commandId, code, message, trackRevision: command.trackRevision } satisfies TransportProcessorMessage);
  }

  private fail(message: string): void {
    if (this.faulted) return;
    this.faulted = true;
    this.cancelScheduled('context-interrupted', message);
    this.port.postMessage({ type: 'fault', message } satisfies TransportProcessorMessage);
  }

  private zeroOutputs(outputs: Float32Array[][]): void {
    for (const output of outputs) for (const channel of output) channel.fill(0);
  }
}

registerProcessor('rimvo-dual-transport', DualDeckTransportProcessor);
