import { readBandlimitedSample } from './polyphase-resampler';

export type TransportDeckId = 'A' | 'B';

export interface StereoOutputBuffers {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

export interface DualTransportOutputs {
  readonly A: StereoOutputBuffers;
  readonly B: StereoOutputBuffers;
}

export interface KernelBeatGrid {
  readonly bpm: number;
  readonly firstBeatFrame: number;
}

export interface FrameLoop {
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface TransportPosition {
  readonly trackRevision: number;
  readonly frame: number;
  readonly contextFrame: number;
  readonly playing: boolean;
  readonly rate: number;
}

interface DeckState {
  channels: readonly Float32Array[] | null;
  frameCount: number;
  revision: number;
  positionFrame: number;
  playing: boolean;
  tempoPercent: number;
  beatGridBpm: number | null;
  beatGridFirstFrame: number;
  syncMasterId: TransportDeckId | null;
  syncAlignPhase: boolean;
  nominalRate: number;
  currentRate: number;
  targetRate: number;
  rateRampRemaining: number;
  scratchActive: boolean;
  scratchWasPlaying: boolean;
  scratchRate: number;
  scratchTargetRate: number;
  scratchRampRemaining: number;
  scratchLastUpdateFrame: number;
  nudgeOffset: number;
  nudgeStart: number;
  nudgeRemaining: number;
  nudgeTotal: number;
  transportRunning: boolean;
  loopStartFrame: number;
  loopEndFrame: number;
  loopActive: boolean;
  outputGain: number;
  targetGain: number;
  transitionRemaining: number;
  pauseAfterFade: boolean;
  clearPending: boolean;
  seekActive: boolean;
  seekFromFrame: number;
  seekProgress: number;
  seekFromHeld: boolean;
  seekHeldLeft: number;
  seekHeldRight: number;
  lastDryLeft: number;
  lastDryRight: number;
  clearAppliedFrame: number;
  endPending: boolean;
}

function createDeckState(): DeckState {
  return {
    channels: null,
    frameCount: 0,
    revision: 0,
    positionFrame: 0,
    playing: false,
    tempoPercent: 0,
    beatGridBpm: null,
    beatGridFirstFrame: 0,
    syncMasterId: null,
    syncAlignPhase: true,
    nominalRate: 1,
    currentRate: 1,
    targetRate: 1,
    rateRampRemaining: 0,
    scratchActive: false,
    scratchWasPlaying: false,
    scratchRate: 0,
    scratchTargetRate: 0,
    scratchRampRemaining: 0,
    scratchLastUpdateFrame: 0,
    nudgeOffset: 0,
    nudgeStart: 0,
    nudgeRemaining: 0,
    nudgeTotal: 0,
    transportRunning: false,
    loopStartFrame: 0,
    loopEndFrame: 0,
    loopActive: false,
    outputGain: 0,
    targetGain: 0,
    transitionRemaining: 0,
    pauseAfterFade: false,
    clearPending: false,
    seekActive: false,
    seekFromFrame: 0,
    seekProgress: 0,
    seekFromHeld: false,
    seekHeldLeft: 0,
    seekHeldRight: 0,
    lastDryLeft: 0,
    lastDryRight: 0,
    clearAppliedFrame: 0,
    endPending: false,
  };
}

export class DualDeckTransportKernel {
  private readonly decks: Record<TransportDeckId, DeckState> = {
    A: createDeckState(),
    B: createDeckState(),
  };
  private readonly sampleRate: number;
  private readonly transitionFrames: number;
  private readonly tempoRampFrames: number;
  private readonly scratchTimeoutFrames: number;
  private contextFrame = 0;
  private disposed = false;

  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Sample rate must be finite and greater than zero.');
    }
    this.sampleRate = sampleRate;
    this.transitionFrames = Math.max(1, Math.round(sampleRate * 0.005));
    this.tempoRampFrames = Math.max(1, Math.round(sampleRate * 0.01));
    this.scratchTimeoutFrames = Math.max(1, Math.round(sampleRate * 0.05));
  }

  installDeck(id: TransportDeckId, channels: readonly Float32Array[], revision: number): void {
    this.assertActive();
    if (channels.length < 1 || channels.length > 2 || channels.some((channel) => !(channel instanceof Float32Array))) {
      throw new TypeError('Deck PCM must contain one or two Float32Array channels.');
    }

    const frameCount = channels[0].length;
    if (frameCount === 0 || channels.some((channel) => channel.length !== frameCount)) {
      throw new RangeError('Deck PCM channels must have the same nonzero frame count.');
    }
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new RangeError('Track revision must be a nonnegative safe integer.');
    }

    const deck = this.decks[id];
    deck.channels = channels;
    deck.frameCount = frameCount;
    deck.revision = revision;
    deck.positionFrame = 0;
    deck.playing = false;
    deck.tempoPercent = 0;
    deck.beatGridBpm = null;
    deck.beatGridFirstFrame = 0;
    deck.syncMasterId = null;
    deck.nominalRate = 1;
    deck.currentRate = 1;
    deck.targetRate = 1;
    deck.rateRampRemaining = 0;
    deck.scratchActive = false;
    deck.scratchWasPlaying = false;
    deck.scratchRate = 0;
    deck.scratchTargetRate = 0;
    deck.scratchRampRemaining = 0;
    deck.scratchLastUpdateFrame = this.contextFrame;
    deck.nudgeOffset = 0;
    deck.nudgeStart = 0;
    deck.nudgeRemaining = 0;
    deck.nudgeTotal = 0;
    deck.transportRunning = false;
    deck.loopStartFrame = 0;
    deck.loopEndFrame = 0;
    deck.loopActive = false;
    deck.outputGain = 0;
    deck.targetGain = 0;
    deck.transitionRemaining = 0;
    deck.pauseAfterFade = false;
    deck.clearPending = false;
    deck.seekActive = false;
    deck.seekFromHeld = false;
    deck.lastDryLeft = 0;
    deck.lastDryRight = 0;
    deck.clearAppliedFrame = 0;
    deck.endPending = false;
  }

  /** Returns true when PCM was released immediately, false when its fade is still running. */
  clearDeck(id: TransportDeckId, revision: number): boolean {
    if (this.disposed) return true;
    const deck = this.decks[id];
    if (deck.revision !== revision || !deck.channels) return true;

    if (deck.transportRunning && deck.outputGain > 0) {
      deck.playing = false;
      deck.pauseAfterFade = true;
      deck.clearPending = true;
      deck.endPending = false;
      this.rampTo(deck, 0);
      return false;
    }
    this.clearDeckNow(deck);
    deck.clearAppliedFrame = this.contextFrame;
    return true;
  }

  hasDeck(id: TransportDeckId): boolean {
    return this.decks[id].channels !== null;
  }

  getClearAppliedFrame(id: TransportDeckId): number {
    return this.decks[id].clearAppliedFrame;
  }

  playDeck(id: TransportDeckId): void {
    this.assertActive();
    const deck = this.decks[id];
    if (!deck.channels) return;
    // Restart only at the end. Paused positions, cue points and active loops
    // keep their existing transport semantics; paired play uses this same path.
    if (!deck.loopActive && deck.positionFrame >= deck.frameCount) {
      deck.positionFrame = 0;
      deck.seekActive = false;
      deck.currentRate = deck.nominalRate;
    }
    if (deck.currentRate === 0) deck.currentRate = deck.nominalRate;
    deck.targetRate = deck.nominalRate;
    deck.rateRampRemaining = 0;
    deck.scratchActive = false;
    deck.playing = true;
    deck.targetRate = deck.nominalRate;
    if (deck.currentRate === 0) deck.currentRate = deck.nominalRate;
    deck.transportRunning = true;
    deck.pauseAfterFade = false;
    deck.clearPending = false;
    deck.endPending = false;
    this.rampTo(deck, 1);
  }

  pauseDeck(id: TransportDeckId): void {
    if (this.disposed) return;
    const deck = this.decks[id];
    deck.playing = false;
    deck.scratchActive = false;
    deck.scratchTargetRate = 0;
    deck.scratchRampRemaining = 0;
    deck.nudgeOffset = 0;
    deck.nudgeRemaining = 0;
    deck.targetRate = deck.nominalRate;
    deck.rateRampRemaining = 0;
    if (!deck.transportRunning || deck.outputGain === 0) {
      deck.transportRunning = false;
      deck.pauseAfterFade = false;
      return;
    }
    deck.pauseAfterFade = true;
    deck.clearPending = false;
    this.rampTo(deck, 0);
  }

  seekDeck(id: TransportDeckId, frame: number): void {
    this.assertActive();
    if (!Number.isFinite(frame)) {
      throw new RangeError('Seek frame must be finite.');
    }

    const deck = this.decks[id];
    const bounded = Math.max(0, Math.min(deck.frameCount, Math.floor(frame)));
    const targetFrame = deck.loopActive && (bounded < deck.loopStartFrame || bounded >= deck.loopEndFrame)
      ? deck.loopStartFrame
      : bounded;

    if (deck.playing && deck.transportRunning && targetFrame >= deck.frameCount && deck.frameCount > 0) {
      deck.endPending = true;
      deck.pauseAfterFade = true;
      deck.playing = false;
      this.rampTo(deck, 0);
      return;
    }

    if (deck.transportRunning && deck.outputGain > 0) {
      if (!deck.playing || deck.seekActive) {
        deck.seekHeldLeft = deck.lastDryLeft;
        deck.seekHeldRight = deck.lastDryRight;
        deck.seekFromHeld = true;
      } else {
        deck.seekFromFrame = deck.positionFrame;
        deck.seekFromHeld = false;
      }
      deck.seekActive = true;
      deck.seekProgress = 0;
    } else {
      deck.seekActive = false;
      deck.seekFromHeld = false;
    }

    deck.endPending = false;
    deck.positionFrame = targetFrame;
    if (deck.frameCount === 0) {
      deck.playing = false;
      deck.transportRunning = false;
    }
  }

  setLoop(id: TransportDeckId, loop: FrameLoop | null): void {
    this.assertActive();
    const deck = this.decks[id];
    if (loop === null) {
      deck.loopActive = false;
      deck.loopStartFrame = 0;
      deck.loopEndFrame = 0;
      if (deck.positionFrame >= deck.frameCount) deck.playing = false;
      return;
    }

    const loopLength = loop.endFrame - loop.startFrame;
    if (
      !Number.isFinite(loop.startFrame)
      || !Number.isFinite(loop.endFrame)
      || loop.startFrame < 0
      || loopLength < Math.max(2, this.transitionFrames * 2)
      || loop.endFrame > deck.frameCount
    ) {
      throw new RangeError('Loop must be at least 10 ms and fit within the loaded track.');
    }

    deck.loopStartFrame = loop.startFrame;
    deck.loopEndFrame = loop.endFrame;
    deck.loopActive = true;
    if (deck.positionFrame < loop.startFrame || deck.positionFrame >= loop.endFrame) {
      this.seekDeck(id, loop.startFrame);
    }
  }

  setTempoPercent(id: TransportDeckId, percent: number): void {
    this.assertActive();
    if (!Number.isFinite(percent) || percent < -16 || percent > 16) throw new RangeError('Tempo must be finite and between -16 and 16 percent.');
    const deck = this.decks[id];
    deck.tempoPercent = percent;
    deck.nominalRate = 1 + percent / 100;
    deck.targetRate = deck.nominalRate;
    if (deck.scratchActive) return;
    if (!deck.playing) {
      deck.currentRate = deck.nominalRate;
      deck.rateRampRemaining = 0;
      return;
    }
    deck.rateRampRemaining = this.tempoRampFrames;
  }

  setBeatGrid(id: TransportDeckId, grid: KernelBeatGrid | null): void {
    this.assertActive();
    const deck = this.decks[id];
    if (grid === null) {
      deck.beatGridBpm = null;
      deck.beatGridFirstFrame = 0;
      deck.syncMasterId = null;
      return;
    }
    if (!Number.isFinite(grid.bpm) || grid.bpm < 30 || grid.bpm > 400 || !Number.isFinite(grid.firstBeatFrame) || grid.firstBeatFrame < 0) {
      throw new RangeError('Beat grid must have a finite BPM and nonnegative first beat frame.');
    }
    deck.beatGridBpm = grid.bpm;
    deck.beatGridFirstFrame = grid.firstBeatFrame;
  }

  syncDeck(id: TransportDeckId, masterId: TransportDeckId | null,alignPhase=true): void {
    this.assertActive();
    const deck = this.decks[id];
    if (masterId === null) {
      deck.syncMasterId = null;
      deck.targetRate = deck.nominalRate;
      deck.rateRampRemaining = deck.playing ? this.tempoRampFrames : 0;
      if (!deck.playing) deck.currentRate = deck.nominalRate;
      return;
    }
    if (masterId === id) throw new RangeError('A deck cannot sync to itself.');
    const master = this.decks[masterId];
    if (!deck.beatGridBpm || !master.beatGridBpm || (alignPhase&&!master.playing) || deck.scratchActive || master.scratchActive) {
      throw new RangeError('Sync requires two beat grids and a playing master.');
    }
    const masterRate = master.playing ? master.currentRate + master.nudgeOffset : master.nominalRate;
    const nextRate = masterRate * master.beatGridBpm / deck.beatGridBpm;
    if (!Number.isFinite(nextRate) || nextRate < 0.84 || nextRate > 1.16) throw new RangeError('Sync rate is outside the supported tempo range.');
    if(alignPhase){
    const phase = this.beatPhase(master);
    const period = this.sampleRate * 60 / deck.beatGridBpm;
    const nearestBeatIndex = Math.round((deck.positionFrame - deck.beatGridFirstFrame) / period);
    const minBeatIndex = Math.ceil((0 - deck.beatGridFirstFrame) / period - phase);
    const maxBeatIndex = Math.floor((deck.frameCount - 1 - deck.beatGridFirstFrame) / period - phase);
    if (minBeatIndex > maxBeatIndex) throw new RangeError('No same-phase beat position fits within the slave track.');
    const boundedBeatIndex = Math.max(minBeatIndex, Math.min(maxBeatIndex, nearestBeatIndex));
    let boundedTarget = deck.beatGridFirstFrame + (boundedBeatIndex + phase) * period;
    if (deck.loopActive && (boundedTarget < deck.loopStartFrame || boundedTarget >= deck.loopEndFrame)) {
      // Wrap into the active loop like playback does, so seekDeck never snaps to loopStart behind our back.
      const loopLength = deck.loopEndFrame - deck.loopStartFrame;
      boundedTarget = deck.loopStartFrame + ((boundedTarget - deck.loopStartFrame) % loopLength + loopLength) % loopLength;
    }
    this.seekDeck(id, boundedTarget);
    deck.positionFrame = boundedTarget;
    }
    const percent = (nextRate - 1) * 100;
    deck.tempoPercent = percent;
    deck.nominalRate = nextRate;
    deck.targetRate = nextRate;
    deck.currentRate = nextRate;
    deck.rateRampRemaining = 0;
    deck.syncMasterId = masterId;
    deck.syncAlignPhase = alignPhase;
  }

  beginScratch(id: TransportDeckId): void {
    this.assertActive();
    const deck = this.decks[id];
    if (!deck.channels) throw new Error('Cannot scratch an empty deck.');
    if (deck.scratchActive) {
      deck.scratchLastUpdateFrame = this.contextFrame;
      return;
    }
    deck.scratchWasPlaying = deck.playing;
    deck.scratchActive = true;
    deck.scratchRate = 0;
    deck.scratchTargetRate = 0;
    deck.scratchRampRemaining = 0;
    deck.scratchLastUpdateFrame = this.contextFrame;
    deck.playing = false;
    deck.nudgeOffset = 0;
    deck.nudgeRemaining = 0;
    if (deck.transportRunning && deck.outputGain > 0) {
      deck.pauseAfterFade = true;
      this.rampTo(deck, 0);
    }
  }

  updateScratch(id: TransportDeckId, positionFrame: number, velocity: number): void {
    this.assertActive();
    if (!Number.isFinite(positionFrame) || !Number.isFinite(velocity)) throw new RangeError('Scratch position and velocity must be finite.');
    const deck = this.decks[id];
    if (!deck.channels || !deck.scratchActive) return;
    const bounded = Math.max(0, Math.min(deck.frameCount - 1, positionFrame));
    const targetRate = Math.max(-2, Math.min(2, velocity));
    if (deck.transportRunning && deck.outputGain > 0) {
      deck.seekHeldLeft = deck.lastDryLeft;
      deck.seekHeldRight = deck.lastDryRight;
      deck.seekFromHeld = true;
      deck.seekActive = true;
      deck.seekProgress = 0;
    } else {
      deck.seekActive = false;
      deck.seekFromHeld = false;
    }
    deck.positionFrame = bounded;
    deck.scratchTargetRate = targetRate;
    if (targetRate === 0) {
      deck.scratchRampRemaining = this.transitionFrames;
    } else {
      deck.scratchRate = targetRate;
      deck.scratchRampRemaining = 0;
    }
    deck.scratchLastUpdateFrame = this.contextFrame;
    deck.endPending = false;
    if (targetRate === 0) {
      deck.playing = false;
      deck.pauseAfterFade = true;
      this.rampTo(deck, 0);
      return;
    }
    deck.transportRunning = true;
    deck.pauseAfterFade = false;
    this.rampTo(deck, 1);
  }

  endScratch(id: TransportDeckId): void {
    if (this.disposed) return;
    const deck = this.decks[id];
    if (!deck.scratchActive) return;
    const resume = deck.scratchWasPlaying;
    const releaseRate = deck.scratchRate;
    deck.scratchActive = false;
    deck.scratchWasPlaying = false;
    deck.scratchTargetRate = 0;
    deck.scratchRampRemaining = 0;
    deck.scratchRate = 0;
    deck.playing = resume;
    if (resume) deck.currentRate = releaseRate;
    deck.targetRate = deck.nominalRate;
    deck.rateRampRemaining = resume ? this.tempoRampFrames : 0;
    if (resume) {
      deck.transportRunning = true;
      deck.pauseAfterFade = false;
      deck.clearPending = false;
      this.rampTo(deck, 1);
    } else if (deck.transportRunning && deck.outputGain > 0) {
      deck.pauseAfterFade = true;
      this.rampTo(deck, 0);
    } else {
      deck.transportRunning = false;
      deck.pauseAfterFade = false;
      deck.outputGain = 0;
      deck.targetGain = 0;
      deck.transitionRemaining = 0;
    }
  }

  nudgeDeck(id: TransportDeckId, deltaPercent: number): void {
    this.assertActive();
    if (!Number.isFinite(deltaPercent) || deltaPercent < -4 || deltaPercent > 4) throw new RangeError('Nudge must be finite and between -4 and 4 percent.');
    const deck = this.decks[id];
    if (!deck.channels || !deck.playing || deck.scratchActive) return;
    deck.nudgeStart = deck.nominalRate * deltaPercent / 100;
    deck.nudgeOffset = deck.nudgeStart;
    deck.nudgeTotal = Math.max(1, Math.round(this.transitionFrames * 25));
    deck.nudgeRemaining = deck.nudgeTotal;
  }

  holdNudge(id:TransportDeckId,deltaPercent:number):void {
    this.assertActive();
    if(!Number.isFinite(deltaPercent)||deltaPercent < -4||deltaPercent > 4)throw new RangeError('Nudge must be between -4 and 4 percent.');
    const deck=this.decks[id];
    deck.nudgeStart=deck.nominalRate*deltaPercent/100;
    deck.nudgeOffset=deck.nudgeStart;
    deck.nudgeTotal=0;
    deck.nudgeRemaining=0;
  }

  processInto(outputs: DualTransportOutputs, contextStartFrame: number, outputStart = 0, requestedFrames = Number.MAX_SAFE_INTEGER): void {
    if (!Number.isSafeInteger(outputStart) || outputStart < 0 || outputStart > outputs.A.left.length || !Number.isSafeInteger(requestedFrames) || requestedFrames < 0) throw new RangeError('Output frame range must be nonnegative safe integers.');
    const frameCount = Math.min(
      requestedFrames,
      outputs.A.left.length - outputStart,
      outputs.A.right.length - outputStart,
      outputs.B.left.length - outputStart,
      outputs.B.right.length - outputStart,
    );
    if (!Number.isSafeInteger(contextStartFrame) || contextStartFrame < 0) {
      throw new RangeError('Context frame must be a nonnegative safe integer.');
    }

    const deckA = this.decks.A;
    const deckB = this.decks.B;
    for (let index = 0; index < frameCount; index += 1) {
      this.updateMotion(deckA, contextStartFrame + index);
      this.updateMotion(deckB, contextStartFrame + index);
      this.updateSync(deckA);
      this.updateSync(deckB);
      const gainA = this.updateGain(deckA);
      const loopGainA = this.loopGain(deckA) * this.trackEndGain(deckA);
      const leftA = this.readBlendedChannel(deckA, 0) * loopGainA;
      const rightA = this.readBlendedChannel(deckA, 1) * loopGainA;
      deckA.lastDryLeft = leftA;
      deckA.lastDryRight = rightA;
      outputs.A.left[outputStart + index] = this.finiteSample(leftA * gainA);
      outputs.A.right[outputStart + index] = this.finiteSample(rightA * gainA);
      this.advanceSeek(deckA);
      this.advance(deckA);
      this.finishTransition(deckA, contextStartFrame + index + 1);

      const gainB = this.updateGain(deckB);
      const loopGainB = this.loopGain(deckB) * this.trackEndGain(deckB);
      const leftB = this.readBlendedChannel(deckB, 0) * loopGainB;
      const rightB = this.readBlendedChannel(deckB, 1) * loopGainB;
      deckB.lastDryLeft = leftB;
      deckB.lastDryRight = rightB;
      outputs.B.left[outputStart + index] = this.finiteSample(leftB * gainB);
      outputs.B.right[outputStart + index] = this.finiteSample(rightB * gainB);
      this.advanceSeek(deckB);
      this.advance(deckB);
      this.finishTransition(deckB, contextStartFrame + index + 1);
    }

    this.contextFrame = contextStartFrame + frameCount;
  }

  readPosition(id: TransportDeckId): TransportPosition {
    const deck = this.decks[id];
    return {
      trackRevision: deck.revision,
      frame: deck.positionFrame,
      contextFrame: this.contextFrame,
      playing: deck.playing || (deck.scratchActive && deck.scratchRate !== 0),
      rate: deck.playing || (deck.scratchActive && deck.scratchRate !== 0) ? this.actualRate(deck) : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearDeckNow(this.decks.A);
    this.clearDeckNow(this.decks.B);
    this.disposed = true;
  }

  private readBlendedChannel(deck: DeckState, channel: 0 | 1): number {
    if (this.disposed || !deck.transportRunning || !deck.channels) return 0;
    if (!deck.seekActive) return this.readSampleAt(deck, deck.positionFrame, channel);

    const progress = Math.min(1, (deck.seekProgress + 1) / this.transitionFrames);
    const fromSample = deck.seekFromHeld
      ? channel === 0 ? deck.seekHeldLeft : deck.seekHeldRight
      : this.readSampleAt(deck, deck.seekFromFrame, channel);
    const toSample = this.readSampleAt(deck, deck.positionFrame, channel);
    return fromSample + (toSample - fromSample) * progress;
  }

  private readSampleAt(deck: DeckState, frame: number, channel: 0 | 1): number {
    const channels = deck.channels;
    if (!channels) return 0;
    const source = channels[channel] ?? channels[0];
    const rate = this.sampleRateForRead(deck);
    return readBandlimitedSample(
      source,
      frame,
      rate,
      deck.loopActive ? deck.loopStartFrame : undefined,
      deck.loopActive ? deck.loopEndFrame : undefined,
    );
  }

  private beatPhase(deck: DeckState): number {
    if (!deck.beatGridBpm) return 0;
    const beatFrames = this.sampleRate * 60 / deck.beatGridBpm;
    const raw = (deck.positionFrame - deck.beatGridFirstFrame) / beatFrames;
    return ((raw % 1) + 1) % 1;
  }

  private updateSync(deck: DeckState): void {
    if (!deck.syncMasterId || !deck.beatGridBpm || !deck.playing || deck.scratchActive) return;
    const master = this.decks[deck.syncMasterId];
    if ((!master.playing && deck.syncAlignPhase) || master.scratchActive || !master.beatGridBpm) return;
    const masterRate = master.playing ? master.currentRate + master.nudgeOffset : master.nominalRate;
    const target = masterRate * master.beatGridBpm / deck.beatGridBpm;
    if (Number.isFinite(target) && target >= 0.84 && target <= 1.16) {
      deck.currentRate = target;
      deck.targetRate = target;
      deck.nominalRate = (master.playing ? master.currentRate : master.nominalRate) * master.beatGridBpm / deck.beatGridBpm;
      deck.tempoPercent = (deck.nominalRate - 1) * 100;
      deck.rateRampRemaining = 0;
    }
  }

  private updateMotion(deck: DeckState, contextFrame: number): void {
    if (deck.scratchActive && deck.scratchTargetRate !== 0 && contextFrame - deck.scratchLastUpdateFrame >= this.scratchTimeoutFrames - this.transitionFrames) {
      deck.scratchTargetRate = 0;
      deck.scratchRampRemaining = this.transitionFrames;
      deck.playing = false;
      deck.pauseAfterFade = true;
      this.rampTo(deck, 0);
    }
    if (deck.rateRampRemaining > 0) {
      deck.currentRate += (deck.targetRate - deck.currentRate) / deck.rateRampRemaining;
      deck.rateRampRemaining -= 1;
      if (deck.rateRampRemaining === 0) deck.currentRate = deck.targetRate;
    }
    if (deck.scratchRampRemaining > 0) {
      deck.scratchRate += (deck.scratchTargetRate - deck.scratchRate) / deck.scratchRampRemaining;
      deck.scratchRampRemaining -= 1;
      if (deck.scratchRampRemaining === 0) deck.scratchRate = deck.scratchTargetRate;
    }
    if (deck.nudgeRemaining > 0) {
      deck.nudgeRemaining -= 1;
      deck.nudgeOffset = deck.nudgeStart * deck.nudgeRemaining / Math.max(1, deck.nudgeTotal);
      if (deck.nudgeRemaining === 0) deck.nudgeOffset = 0;
    }
  }

  private actualRate(deck: DeckState): number {
    if (deck.scratchActive) return deck.scratchRate;
    if (!deck.transportRunning && !deck.playing) return 0;
    return deck.currentRate + deck.nudgeOffset;
  }

  private sampleRateForRead(deck: DeckState): number {
    const rate = this.actualRate(deck);
    return rate === 0 ? 1 : rate;
  }

  private updateGain(deck: DeckState): number {
    if (deck.transitionRemaining > 0) {
      deck.outputGain += (deck.targetGain - deck.outputGain) / deck.transitionRemaining;
      deck.transitionRemaining -= 1;
      if (deck.transitionRemaining === 0) deck.outputGain = deck.targetGain;
    }
    return deck.outputGain;
  }

  private finishTransition(deck: DeckState, appliedContextFrame: number): void {
    if (deck.pauseAfterFade && deck.transitionRemaining === 0 && deck.outputGain === 0 && deck.rateRampRemaining === 0) {
      if (deck.endPending) {
        deck.positionFrame = deck.frameCount;
        deck.endPending = false;
      }
      if (deck.clearPending) {
        deck.clearAppliedFrame = appliedContextFrame;
        this.clearDeckNow(deck);
      }
      deck.transportRunning = false;
      deck.pauseAfterFade = false;
      deck.seekActive = false;
    }
  }

  private trackEndGain(deck: DeckState): number {
    if (deck.loopActive || deck.frameCount === 0) return 1;
    const fadeFrames = Math.min(this.transitionFrames, deck.frameCount);
    const rate = this.actualRate(deck);
    const remaining = rate < 0 ? deck.positionFrame : deck.frameCount - deck.positionFrame;
    if (remaining <= fadeFrames) return remaining / (fadeFrames + 1);
    return 1;
  }

  private loopGain(deck: DeckState): number {
    if (!deck.loopActive) return 1;
    const loopLength = deck.loopEndFrame - deck.loopStartFrame;
    const fadeFrames = Math.min(this.transitionFrames, Math.floor(loopLength / 2));
    if (fadeFrames <= 0) return 1;
    const offset = ((deck.positionFrame - deck.loopStartFrame) % loopLength + loopLength) % loopLength;
    if (offset < fadeFrames) return (offset + 1) / (fadeFrames + 1);
    if (offset >= loopLength - fadeFrames) return (loopLength - offset) / (fadeFrames + 1);
    return 1;
  }

  private advanceSeek(deck: DeckState): void {
    if (!deck.seekActive) return;
    deck.seekProgress += 1;
    if (!deck.seekFromHeld) {
      deck.seekFromFrame = Math.min(deck.frameCount, deck.seekFromFrame + 1);
    }
    if (deck.seekProgress >= this.transitionFrames) {
      deck.seekActive = false;
      deck.seekFromHeld = false;
    }
  }

  private advance(deck: DeckState): void {
    if (this.disposed || !deck.transportRunning || !deck.channels || deck.endPending) return;
    if (deck.pauseAfterFade && !deck.clearPending) return;

    const rate = this.actualRate(deck);
    if (rate === 0) return;
    const nextFrame = deck.positionFrame + rate;
    if (deck.loopActive && (nextFrame >= deck.loopEndFrame || nextFrame < deck.loopStartFrame)) {
      const loopLength = deck.loopEndFrame - deck.loopStartFrame;
      deck.positionFrame = deck.loopStartFrame + ((nextFrame - deck.loopStartFrame) % loopLength + loopLength) % loopLength;
      return;
    }

    if ((rate >= 0 && nextFrame >= deck.frameCount) || (rate < 0 && nextFrame < 0)) {
      if (deck.pauseAfterFade) {
        deck.positionFrame = Math.max(0, deck.frameCount - 1);
        return;
      }
      deck.positionFrame = rate < 0 ? 0 : deck.frameCount;
      if (deck.scratchActive) {
        deck.scratchRate = 0;
        deck.scratchTargetRate = 0;
        deck.scratchRampRemaining = 0;
      }
      deck.playing = false;
      deck.transportRunning = false;
      deck.outputGain = 0;
      deck.targetGain = 0;
      deck.transitionRemaining = 0;
      deck.pauseAfterFade = false;
      deck.seekActive = false;
      return;
    }
    deck.positionFrame = nextFrame;
  }

  private rampTo(deck: DeckState, value: number): void {
    deck.targetGain = value;
    if (deck.outputGain === value) {
      deck.transitionRemaining = 0;
    } else {
      deck.transitionRemaining = this.transitionFrames;
    }
  }

  private clearDeckNow(deck: DeckState): void {
    deck.channels = null;
    deck.frameCount = 0;
    deck.positionFrame = 0;
    deck.playing = false;
    deck.tempoPercent = 0;
    deck.beatGridBpm = null;
    deck.beatGridFirstFrame = 0;
    deck.syncMasterId = null;
    deck.nominalRate = 1;
    deck.currentRate = 1;
    deck.targetRate = 1;
    deck.rateRampRemaining = 0;
    deck.scratchActive = false;
    deck.scratchWasPlaying = false;
    deck.scratchRate = 0;
    deck.scratchTargetRate = 0;
    deck.scratchRampRemaining = 0;
    deck.scratchLastUpdateFrame = this.contextFrame;
    deck.nudgeOffset = 0;
    deck.nudgeStart = 0;
    deck.nudgeRemaining = 0;
    deck.nudgeTotal = 0;
    deck.transportRunning = false;
    deck.loopStartFrame = 0;
    deck.loopEndFrame = 0;
    deck.loopActive = false;
    deck.outputGain = 0;
    deck.targetGain = 0;
    deck.transitionRemaining = 0;
    deck.pauseAfterFade = false;
    deck.clearPending = false;
    deck.seekActive = false;
    deck.seekFromHeld = false;
    deck.endPending = false;
    deck.lastDryLeft = 0;
    deck.lastDryRight = 0;
  }

  private finiteSample(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Transport kernel is disposed.');
    }
  }
}
