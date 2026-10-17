import type { KeyAnalysisSnapshot } from '../audio/types';

// Krumhansl pitch-class profiles; C is pitch class 0, A4 is 440 Hz.
const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const minor=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
export const noteNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'] as const;

function fft(real:Float64Array,imag:Float64Array):void {
  const n=real.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
  for(let size=2;size<=n;size<<=1){
    const angle=-2*Math.PI/size,wr0=Math.cos(angle),wi0=Math.sin(angle);
    for(let start=0;start<n;start+=size){let wr=1,wi=0;
      for(let j=0;j<size/2;j++){const a=start+j,b=a+size/2,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;}
    }
  }
}

function profileScore(chroma:Float64Array,profile:number[],root:number):number {
  const mean=chroma.reduce((sum,x)=>sum+x,0)/12,pMean=profile.reduce((sum,x)=>sum+x,0)/12;
  let product=0,a=0,b=0;
  for(let i=0;i<12;i++){const x=chroma[i]-mean,y=profile[(i-root+12)%12]-pMean;product+=x*y;a+=x*x;b+=y*y;}
  return product/Math.sqrt(a*b||1);
}

export function analyzeKey(channels:readonly Float32Array[],sampleRate:number):KeyAnalysisSnapshot {
  const unavailable:KeyAnalysisSnapshot={status:'unavailable',tonic:null,mode:'unknown',confidence:0};
  if(!channels.length||!Number.isFinite(sampleRate)||sampleRate<8000||channels[0].length<sampleRate*.25)return Object.freeze(unavailable);
  const n=4096,stride=Math.max(1,Math.floor(sampleRate/12000)),rate=sampleRate/stride,span=n*stride;
  const real=new Float64Array(n),imag=new Float64Array(n),mag=new Float64Array(n/2),chroma=new Float64Array(12);
  const count=Math.min(32,Math.max(1,Math.floor(channels[0].length/span)));
  let tonalFrames=0;
  for(let window=0;window<count;window++){
    const start=Math.round((channels[0].length-span)*window/Math.max(1,count-1));
    let channel=channels[0],bestEnergy=0;
    for(const candidate of channels){let energy=0;for(let i=0;i<span;i+=64){const v=candidate[start+i]??0;energy+=v*v;}if(energy>bestEnergy){bestEnergy=energy;channel=candidate;}}
    imag.fill(0);
    for(let i=0;i<n;i++){let value=0;for(let k=0;k<stride;k++)value+=channel[start+i*stride+k]??0;real[i]=value/stride*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));}
    fft(real,imag);let peak=0,energy=0;
    for(let k=1;k<n/2;k++){mag[k]=Math.hypot(real[k],imag[k]);peak=Math.max(peak,mag[k]);energy+=mag[k]*mag[k];}
    if(peak<.001||peak*peak/(energy||1)<.02)continue;
    tonalFrames++;
    for(let k=Math.ceil(55*n/rate);k<Math.min(n/2-1,4000*n/rate);k++){
      if(mag[k]<peak*.03||mag[k]<=mag[k-1]||mag[k]<=mag[k+1])continue;
      const a=Math.log(mag[k-1]+1e-12),b=Math.log(mag[k]+1e-12),c=Math.log(mag[k+1]+1e-12);
      const offset=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
      const frequency=(k+offset)*rate/n,midi=69+12*Math.log2(frequency/440),note=Math.round(midi);
      const weight=Math.cos(Math.min(.5,Math.abs(midi-note))*Math.PI)**2;
      chroma[((note%12)+12)%12]+=mag[k]**.7*weight/Math.sqrt(frequency/110);
    }
  }
  const peak=Math.max(...chroma);if(!tonalFrames||peak<=0)return Object.freeze(unavailable);
  const active=Array.from(chroma).filter(x=>x>peak*.15).length;
  const dominant=Array.from(chroma).indexOf(peak);
  if(active<3)return Object.freeze({status:'complete',tonic:dominant,mode:'unknown',confidence:Math.min(.9,peak/(chroma.reduce((s,x)=>s+x,0)||1))});
  const candidates=Array.from({length:24},(_,i)=>({tonic:i%12,mode:i<12?'major' as const:'minor' as const,score:profileScore(chroma,i<12?major:minor,i%12)})).sort((a,b)=>b.score-a.score);
  const best=candidates[0],margin=best.score-candidates[1].score;
  if(best.score<.4)return Object.freeze(unavailable);
  const confidence=Math.max(0,Math.min(1,best.score*(.4+margin*2)));
  return Object.freeze({status:'complete',tonic:best.tonic,mode:best.mode,confidence});
}

export function shiftedNote(key:KeyAnalysisSnapshot|undefined,semitones:number):string|null {
  if(key?.tonic===null||key?.tonic===undefined)return null;
  return noteNames[((key.tonic+Math.round(semitones))%12+12)%12]+(key.mode==='minor'?'m':key.mode==='major'?' maj':'');
}

export function pitchForTarget(tonic:number,target:number,current:number):number {
  const candidates=Array.from({length:5},(_,i)=>target-tonic+(i-2)*12).filter(x=>x>=-12&&x<=12);
  return candidates.sort((a,b)=>Math.abs(a-current)-Math.abs(b-current))[0];
}
