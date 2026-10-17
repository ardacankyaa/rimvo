import { describe,expect,it } from 'vitest';
import { analyzeKey,pitchForTarget } from '../../src/analysis/key-analysis';

function signal(frequencies:number[],sampleRate=48000,seconds=2){return Float32Array.from({length:sampleRate*seconds},(_,i)=>frequencies.reduce((sum,f,index)=>sum+(.2/(index+1))*Math.sin(2*Math.PI*f*i/sampleRate),0));}
describe('local tonal analysis',()=>{
  it('recognizes A440 without inventing a major/minor scale',()=>{const key=analyzeKey([signal([440])],48000);expect(key.tonic).toBe(9);expect(key.mode).toBe('unknown');});
  it('uses a tonal right channel rather than cancelling stereo audio',()=>{const right=signal([523.251],44100);expect(analyzeKey([new Float32Array(right.length),right],44100).tonic).toBe(0);});
  it.each([[[261.626,329.628,391.995],0,'major'],[[220,261.626,329.628],9,'minor']] as const)('finds the root and scale of a known triad',(frequencies,tonic,mode)=>{const key=analyzeKey([signal([...frequencies])],48000);expect(key.tonic).toBe(tonic);expect(key.mode).toBe(mode);});
  it('leaves silence and noise without a claimed key',()=>{
    expect(analyzeKey([new Float32Array(96000)],48000).tonic).toBeNull();
    let seed=123;const noise=Float32Array.from({length:96000},()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed/2147483648)*.1;});
    expect(analyzeKey([noise],48000).tonic).toBeNull();
  });
  it('chooses a reachable target note without changing an octave unnecessarily',()=>{expect(pitchForTarget(9,0,0)).toBe(3);expect(pitchForTarget(9,0,-8)).toBe(-9);});
});
