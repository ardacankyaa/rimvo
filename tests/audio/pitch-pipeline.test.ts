import { describe, expect, it } from 'vitest';
import { PitchPipeline } from '../../src/dsp/pitch-pipeline';

function render(rate:number,semitones:number,independent=true){
  const sampleRate=48000,seconds=3,pipeline=new PitchPipeline(sampleRate);
  const l=new Float32Array(128),r=new Float32Array(128),ol=new Float32Array(128),or=new Float32Array(128);
  const left=new Float32Array(sampleRate*seconds),right=new Float32Array(left.length);
  for(let start=0;start<left.length;start+=128){
    for(let i=0;i<128;i++){const t=(start+i)/sampleRate;l[i]=.25*Math.sin(2*Math.PI*440*rate*t);r[i]=.2*Math.sin(2*Math.PI*660*rate*t);}
    pipeline.process(l,r,ol,or,2**(semitones/12)/rate,independent);
    left.set(ol.subarray(0,Math.min(128,left.length-start)),start);right.set(or.subarray(0,Math.min(128,right.length-start)),start);
  }
  const frequency=(samples:Float32Array)=>{let crossings=0;const start=sampleRate,end=samples.length-128;for(let i=start+1;i<end;i++)if(samples[i-1]<=0&&samples[i]>0)crossings++;return crossings*sampleRate/(end-start);};
  const rms=(samples:Float32Array)=>Math.sqrt(samples.slice(sampleRate).reduce((s,x)=>s+x*x,0)/(samples.length-sampleRate));
  return {pipeline,left,right,leftFrequency:frequency(left),rightFrequency:frequency(right),rmsLeft:rms(left),rmsRight:rms(right)};
}

describe('independent pitch pipeline',()=>{
  it.each([[1,0],[.84,0],[1.16,0],[1,3],[1,-5],[.84,12],[1.16,-12]])('keeps tempo %.2f independent of tone %i semitones with bounded stereo output',(rate,pitch)=>{
    const result=render(rate,pitch),ratio=2**(pitch/12);
    expect(result.leftFrequency).toBeCloseTo(440*ratio,-1);
    expect(result.rightFrequency).toBeCloseTo(660*ratio,-1);
    expect(result.rmsLeft).toBeGreaterThan(.08);expect(result.rmsRight).toBeGreaterThan(.06);
    expect(result.left.every(x=>Number.isFinite(x)&&Math.abs(x)<.55)).toBe(true);
    expect(result.pipeline.underruns).toBe(0);
    expect(result.pipeline.bufferedFrames).toBeLessThan(12000);
  });
  it('retains tape behavior and clears every old sample on reset',()=>{
    const result=render(1.16,0,false);
    expect(result.leftFrequency).toBeCloseTo(440*1.16,-1);
    result.pipeline.reset();const zeros=new Float32Array(128),output=new Float32Array(128),right=new Float32Array(128);
    for(let i=0;i<50;i++){result.pipeline.process(zeros,zeros,output,right,1,true);expect(output.every(x=>Math.abs(x)<1e-8)).toBe(true);expect(right.every(x=>Math.abs(x)<1e-8)).toBe(true);}
  });
});
