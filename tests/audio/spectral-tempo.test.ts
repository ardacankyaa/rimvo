import {describe,expect,it} from 'vitest';
import {spectralTempo} from '../../src/analysis/spectral-tempo';

function musicalPulse(bpm:number){
  const rate=16000,pcm=new Float32Array(rate*30),period=60/bpm;
  for(let i=0;i<pcm.length;i++)pcm[i]=.07*Math.sin(2*Math.PI*440*i/rate)+.04*Math.sin(2*Math.PI*659.25*i/rate);
  for(let beat=0;beat*period<30;beat++){
    const at=Math.round((beat*period+Math.sin(beat*2.13)*.006)*rate);
    for(let i=0;i<1600&&at+i<pcm.length;i++)if(at+i>=0)pcm[at+i]+=.4*Math.exp(-i/250)*Math.sin(2*Math.PI*75*i/rate);
    const off=at+Math.round(period*.5*rate);
    for(let i=0;i<160&&off+i<pcm.length;i++)if(off+i>=0)pcm[off+i]+=.18*Math.exp(-i/40)*Math.sin(2*Math.PI*3900*i/rate);
  }
  return pcm;
}

describe('spectral attack tempo',()=>{
  it.each([100,126,133])('finds %s BPM with a sustained chord and offbeat percussion',bpm=>{
    const result=spectralTempo([musicalPulse(bpm)],16000);
    expect(result.status).toBe('complete');expect(Math.abs(result.candidates[0].bpm-bpm)).toBeLessThan(.2);expect(result.confidence).toBeLessThan(.75);
  });
  it('keeps stereo phase cancellation from erasing rhythm evidence',()=>{
    const pcm=musicalPulse(100),result=spectralTempo([pcm,Float32Array.from(pcm,value=>-value)],16000);
    expect(result.status).toBe('complete');expect(Math.abs(result.candidates[0].bpm-100)).toBeLessThan(.2);
  });
});
