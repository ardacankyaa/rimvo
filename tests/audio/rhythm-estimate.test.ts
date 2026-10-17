import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {analyzeBpm} from '../../src/analysis/bpm-analysis';
import {estimateRhythm} from '../../src/analysis/rhythm-estimate';

function wav(file:string){const bytes=readFileSync(new URL('../../public/demo-tracks/'+file,import.meta.url));const channels=bytes.readUInt16LE(22),rate=bytes.readUInt32LE(24),frames=bytes.readUInt32LE(40)/2/channels;const pcm=Array.from({length:channels},()=>new Float32Array(frames));for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)pcm[c][i]=bytes.readInt16LE(44+(i*channels+c)*2)/32768;return {pcm,rate};}
describe('music tempo estimates',()=>{
  it('accepts natural attack timing spread without inventing a trusted phase grid',()=>{
    const rate=16000,pcm=new Float32Array(rate*24);
    for(let beat=0;beat<40;beat++){
      const start=Math.round((beat*.6+Math.sin(beat*2.17)*.012)*rate);
      for(let i=0;i<900&&start+i<pcm.length;i++)if(start+i>=0)pcm[start+i]+=.4*Math.exp(-i/220)*Math.sin(2*Math.PI*80*i/rate);
    }
    const result=analyzeBpm([pcm],rate);expect(result.status).toBe('complete');expect(result.candidates[0].bpm).toBeCloseTo(100,0);expect(result.confidence).toBeLessThan(.75);
  });
  it.each([['after-hours.wav',118],['open-circuit.wav',124]] as const)('finds BPM from real demo PCM without manifest metadata: %s',(file,bpm)=>{const audio=wav(file),result=analyzeBpm(audio.pcm,audio.rate);expect(result.status).toBe('complete');expect(result.candidates[0].bpm).toBeCloseTo(bpm,0);});
  it('finds a syncopated rhythm with bass, offbeat percussion and a sustained note',()=>{
    const rate=16000,bpm=126,samples=new Float32Array(rate*20),period=60/bpm;
    for(let i=0;i<samples.length;i++){const t=i/rate,beat=t/period,phase=beat%1,off=(beat+.5)%1;const kick=Math.exp(-phase*period*35)*Math.sin(2*Math.PI*65*t);const hat=Math.exp(-off*period*100)*Math.sin(2*Math.PI*3800*t);samples[i]=.35*kick+.1*hat+.12*Math.sin(2*Math.PI*440*t);}
    const result=analyzeBpm([samples],rate);expect(result.status).toBe('complete');expect(result.candidates[0].bpm).toBeCloseTo(bpm,0);
  });
  it('does not assign BPM to silence, a static note or unrelated noise',()=>{
    const rate=16000,silence=new Float32Array(rate*12),tone=Float32Array.from(silence,(_,i)=>.2*Math.sin(2*Math.PI*440*i/rate));let seed=11;const noise=Float32Array.from(silence,()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2**32-.5)*.1;});
    for(const signal of [silence,tone,noise]){const result=analyzeBpm([signal],rate);expect(result.status,JSON.stringify(result)).toBe('unavailable');}
  });
  it('keeps fallback estimates below the threshold for an automatically trusted phase grid',()=>{
    const audio=wav('open-circuit.wav'),result=estimateRhythm(audio.pcm,audio.rate);expect(result.status).toBe('complete');expect(result.confidence).toBeLessThan(.75);
  });
});
