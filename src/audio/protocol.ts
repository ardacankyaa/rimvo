import type { BeatDivision, CommandAck, DeckId } from './types';
import type { FrameLoop, KernelBeatGrid, TransportPosition } from '../dsp/transport-kernel';

type CommandBase = {
  readonly commandId: number;
  readonly requestedFrame: number;
  readonly deckId: DeckId;
  readonly trackRevision: number;
  readonly applyFrame?: number;
};

export type TransportCommand =
  | TransportPair
  | (CommandBase & { readonly type: 'install'; readonly channels: Float32Array[] })
  | (CommandBase & { readonly type: 'clear' | 'play' | 'pause' | 'scratch-begin' | 'scratch-end' })
  | (CommandBase & { readonly type: 'seek'; readonly mediaFrame: number })
  | (CommandBase & { readonly type: 'loop'; readonly loop: FrameLoop | null; readonly loopBeats?: BeatDivision | null })
  | (CommandBase & { readonly type: 'tempo'; readonly tempoPercent: number })
  | (CommandBase & { readonly type: 'nudge' | 'nudge-hold'; readonly deltaPercent: number })
  | (CommandBase & { readonly type: 'sync'; readonly masterId: DeckId | null; readonly alignPhase?:boolean })
  | {
      readonly type: 'scratch-update';
      readonly deckId: DeckId;
      readonly trackRevision: number;
      readonly positionFrame: number;
      readonly velocity: number;
    }
  | {
      readonly type: 'grid';
      readonly deckId: DeckId;
      readonly trackRevision: number;
      readonly grid: KernelBeatGrid | null;
    }
  | { readonly type: 'cancel-scheduled'; readonly reason?: 'context-interrupted' | 'disposed' }
  | { readonly type: 'release-scratch' }
  | { readonly type: 'release-nudge' }
  | { readonly type: 'dispose' };

export type SharedTransportCommand = CommandBase & { readonly type: 'play' | 'pause' };
export type TransportPair = { readonly type: 'transport-pair'; readonly applyFrame: number; readonly commands: readonly [SharedTransportCommand, SharedTransportCommand] };
export type AckableTransportCommand = Exclude<TransportCommand, { type: 'transport-pair' | 'scratch-update' | 'grid' | 'cancel-scheduled' | 'release-scratch' | 'release-nudge' | 'dispose' }>;

export type TransportProcessorMessage =
  | { readonly type: 'ack'; readonly ack: CommandAck; readonly position: TransportPosition }
  | {
      readonly type: 'error';
      readonly commandId: number;
      readonly code: 'stale-load' | 'queue-full' | 'invalid-value' | 'context-interrupted' | 'disposed' | 'internal';
      readonly message: string;
      readonly trackRevision: number;
    }
  | {
      readonly type: 'snapshot';
      readonly contextFrame: number;
      readonly positions: Readonly<Record<DeckId, TransportPosition>>;
    }
  | { readonly type: 'fault'; readonly message: string };
