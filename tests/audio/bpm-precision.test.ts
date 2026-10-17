import {describe,expect,it} from 'vitest';
import {analyzeBpm} from '../../src/analysis/bpm-analysis';

function percussion(bpm:number,seconds:number,jitter=.004,rate=8000){
  const samples=new Float32Array(rate*seconds),period=60/bpm;
  for(let beat=0;beat*period<seconds;beat++){
    const at=Math.round((beat*period+Math.sin(beat*2.13)*jitter)*rate);
    for(let i=0;i<rate*.075;i++){const frame=at+i;if(frame<0||frame>=samples.length)continue;samples[frame]+=.45*Math.exp(-i/(rate*.01375))*Math.sin(2*Math.PI*75*i/rate);}
    const off=at+Math.round(period*.5*rate);for(let i=0;i<rate*.01125&&off+i<samples.length;i++)if(off+i>=0)samples[off+i]+=.045*Math.exp(-i/(rate*.00225))*Math.sin(2*Math.PI*2928.451*i/rate);
  }
  return samples;
}
describe('tempo precision and whole-track agreement',()=>{
  it.each([67,99,132])('keeps the same beat unit and tempo for %s BPM at 44.1 and 48 kHz',bpm=>{
    const a=analyzeBpm([percussion(bpm,75,.004,44100)],44100),b=analyzeBpm([percussion(bpm,75,.004,48000)],48000);
    expect(a.status).toBe('complete');expect(b.status).toBe('complete');expect(Math.abs(a.candidates[0].bpm-b.candidates[0].bpm)).toBeLessThan(.1);expect(Math.abs(a.candidates[0].bpm-bpm)).toBeLessThan(.15);
  });
  it.each([50,67,77.5,99,110,118,123.456,132,150,174,210])('fits a known %s BPM pulse across a full musical minute',bpm=>{
    const result=analyzeBpm([percussion(bpm,45)],8000);expect(result.status).toBe('complete');expect(Math.abs(result.candidates[0].bpm-bpm)).toBeLessThan(.15);
  });
  it('uses the sustained song rhythm rather than a different short intro',()=>{
    const samples=percussion(99,180);samples.set(percussion(150,12));const result=analyzeBpm([samples],8000);
    expect(result.status).toBe('complete');expect(Math.abs(result.candidates[0].bpm-99)).toBeLessThan(.15);expect(result.confidence).toBeLessThan(.75);
  });
  it('refuses a single tempo when separate halves have conflicting reliable clocks',()=>{
    const samples=new Float32Array(8000*180);samples.set(percussion(120,90,0));samples.set(percussion(140,90,0),8000*90);
    expect(analyzeBpm([samples],8000).status).toBe('unavailable');
  });
  it('does not hide fractional tempo behind whole-number rounding',()=>{
    const result=analyzeBpm([percussion(123.456,150)],8000);expect(result.status).toBe('complete');expect(Math.abs(result.candidates[0].bpm-123.456)).toBeLessThan(.15);expect(Math.abs(result.candidates[0].bpm-123)).toBeGreaterThan(.2);
  });
});
