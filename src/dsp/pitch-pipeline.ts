import { SoundTouch, registerInterpolationStrategy, hasInterpolationStrategy } from '@soundtouchjs/core';
import { registerLanczosStrategy } from '@soundtouchjs/interpolation-strategy-lanczos';

if (!hasInterpolationStrategy('lanczos')) registerLanczosStrategy({ registerInterpolationStrategy });

/** Stereo pitch correction with a common 64 ms delay for both decks. */
export class PitchPipeline {
  readonly latencyFrames: number;
  private readonly pipe: SoundTouch;
  private readonly delay: Float32Array;
  private readonly input = new Float32Array(4096);
  private readonly output = new Float32Array(4096);
  private delayHead = 0;
  private preparedFrames = 0;
  private correcting = false;
  private renderingProcessed = false;
  private lastLeft = 0;
  private lastRight = 0;
  private bridge = 0;
  private lastIndependent = false;
  underruns = 0;

  constructor(readonly sampleRate: number) {
    this.latencyFrames = Math.ceil(sampleRate * .064);
    this.delay = new Float32Array(this.latencyFrames * 2);
    this.pipe = new SoundTouch({ sampleRate, interpolationStrategy: 'lanczos', sampleBufferType: 'circular' });
    this.pipe.setStretchParameters({ sequenceMs: 16, seekWindowMs: 8, overlapMs: 4, quickSeek: false });
  }

  get bufferedFrames(): number { return this.pipe.inputBuffer.frameCount + this.pipe.outputBuffer.frameCount; }

  reset(): void {
    this.pipe.clear(); this.delay.fill(0); this.delayHead=0; this.preparedFrames=0;
    this.correcting=false; this.renderingProcessed=false; this.bridge=64;
    this.lastLeft=0;this.lastRight=0;
  }

  process(left: Float32Array, right: Float32Array, outLeft: Float32Array, outRight: Float32Array, ratio: number, independent: boolean): void {
    const frames=outLeft.length;
    if (frames > 2048 || !Number.isFinite(ratio) || ratio < .25 || ratio > 4) throw new RangeError('Unsupported pitch block or ratio.');
    const correcting=independent && Math.abs(ratio-1) > .00001;
    if(correcting!==this.correcting){this.pipe.clear();this.preparedFrames=0;this.correcting=correcting;}
    if(independent!==this.lastIndependent){this.bridge=64;this.lastIndependent=independent;}
    for(let i=0;i<frames;i++){this.input[i*2]=left[i]??0;this.input[i*2+1]=right[i]??left[i]??0;}
    let processed=false;
    if(correcting){
      this.pipe.pitch=ratio;
      this.pipe.inputBuffer.putSamples(this.input,0,frames);
      this.pipe.process();this.preparedFrames+=frames;
      if(this.bufferedFrames > this.sampleRate*.5) throw new Error('Pitch buffering exceeded its bound.');
      if(this.preparedFrames >= this.latencyFrames){
        if(this.pipe.outputBuffer.frameCount >= frames){this.pipe.outputBuffer.extract(this.output,0,frames);this.pipe.outputBuffer.receive(frames);processed=true;}
        else this.underruns++;
      }
    }
    if(processed!==this.renderingProcessed){this.bridge=64;this.renderingProcessed=processed;}
    const previousLeft=this.lastLeft,previousRight=this.lastRight;
    for(let i=0;i<frames;i++){
      const offset=this.delayHead*2;
      const delayedLeft=this.delay[offset],delayedRight=this.delay[offset+1];
      this.delay[offset]=this.input[i*2];this.delay[offset+1]=this.input[i*2+1];
      this.delayHead=(this.delayHead+1)%this.latencyFrames;
      let l=processed?this.output[i*2]:independent?delayedLeft:this.input[i*2];
      let r=processed?this.output[i*2+1]:independent?delayedRight:this.input[i*2+1];
      if(this.bridge>0){const blend=1-this.bridge/64;l=previousLeft*(1-blend)+l*blend;r=previousRight*(1-blend)+r*blend;this.bridge--;}
      if(!Number.isFinite(l)||!Number.isFinite(r))throw new Error('Pitch processing produced non-finite audio.');
      outLeft[i]=l;outRight[i]=r;this.lastLeft=l;this.lastRight=r;
    }
  }
}
