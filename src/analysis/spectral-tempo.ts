import type {BpmAnalysisSnapshot} from '../audio/types';
import {fitTempoPeriod,strongOnsets} from './tempo-fit';

function fft(real:Float64Array,imaginary:Float64Array):void {
  const n=real.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const a=real[i],b=imaginary[i];real[i]=real[j];imaginary[i]=imaginary[j];real[j]=a;imaginary[j]=b;}}
  for(let size=2;size<=n;size*=2){const angle=-2*Math.PI/size,stepR=Math.cos(angle),stepI=Math.sin(angle);for(let start=0;start<n;start+=size){let wr=1,wi=0;for(let i=0;i<size/2;i++){const a=start+i,b=a+size/2,tr=wr*real[b]-wi*imaginary[b],ti=wr*imaginary[b]+wi*real[b];real[b]=real[a]-tr;imaginary[b]=imaginary[a]-ti;real[a]+=tr;imaginary[a]+=ti;const next=wr*stepR-wi*stepI;wi=wr*stepI+wi*stepR;wr=next;}}}
}

/** Spectral attacks separate beat evidence from vocals or changing carrier energy. */
export function spectralTempo(channels:readonly Float32Array[],sampleRate:number):BpmAnalysisSnapshot {
  const none:BpmAnalysisSnapshot={status:'unavailable',confidence:0,candidates:[]},size=2**Math.ceil(Math.log2(sampleRate*.046)),hop=Math.round(sampleRate/100),length=Math.floor((channels[0].length-size)/hop);
  if(length<800)return none;
  const window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1))),real=new Float64Array(size),imaginary=new Float64Array(size),previous=new Float64Array(size/2+1),magnitude=new Float64Array(size/2+1),full=new Float64Array(length),low=new Float64Array(length);
  for(let frame=0;frame<length;frame++){
    magnitude.fill(0);
    for(const channel of channels){for(let i=0;i<size;i++){real[i]=channel[frame*hop+i]*window[i];imaginary[i]=0;}fft(real,imaginary);for(let bin=1;bin<magnitude.length;bin++)magnitude[bin]+=Math.hypot(real[bin],imaginary[bin])/channels.length;}
    for(let bin=1;bin<magnitude.length;bin++){const value=Math.log1p(20*magnitude[bin]),change=frame?Math.max(0,value-previous[bin]):0;full[frame]+=change;if(bin*sampleRate/size<=320)low[frame]+=change;previous[bin]=value;}
  }
  const dt=hop/sampleRate,n=2**Math.ceil(Math.log2(length))*4,spectra:Float64Array[]=[],novelties:Float64Array[]=[];
  for(const flux of [full,low]){
    const novelty=new Float64Array(length);let average=0;
    for(let i=0;i<length;i++){average+=flux[i];if(i>=20)average-=flux[i-20];novelty[i]=Math.max(0,flux[i]-average/Math.min(i+1,20));}
    const r=new Float64Array(n),im=new Float64Array(n);r.set(novelty);fft(r,im);const power=new Float64Array(n/2+1);for(let i=0;i<power.length;i++)power[i]=Math.hypot(r[i],im[i]);spectra.push(power);novelties.push(novelty);
  }
  const minimum=Math.ceil(60/60*n*dt),maximum=Math.floor(200/60*n*dt),peaks=spectra.map(power=>{let value=0;for(let i=minimum;i<=maximum;i++)value=Math.max(value,power[i]);return value;});
  let bestBin=0,bestRank=0;
  for(let bin=minimum+1;bin<maximum;bin++){
    // Broadband attacks carry the beat; bass motifs are corroboration, not equal votes.
    const rank=spectra.reduce((sum,power,i)=>sum+(peaks[i]?power[bin]/peaks[i]:0)*(i===0?.8:.2),0)*(1-.035*Math.abs(Math.log2(bin/(n*dt)*60/120)));
    if(rank>bestRank){bestRank=rank;bestBin=bin;}
  }
  if(!bestBin)return none;
  // Strong eighth-note attacks can own the spectrum. Fold only a supported slower pulse.
  if(bestBin/(n*dt)*60>160){const half=Math.round(bestBin/2);let supported=half;for(let bin=half-2;bin<=half+2;bin++)if(spectra[0][bin]>spectra[0][supported])supported=bin;if(spectra[0][supported]>=spectra[0][bestBin]*.35)bestBin=supported;}
  const selected=spectra[0][bestBin]/Math.max(1e-9,peaks[0])>=spectra[1][bestBin]/Math.max(1e-9,peaks[1])?0:1,power=spectra[selected];
  let mean=0;for(let i=minimum;i<=maximum;i++)mean+=power[i];mean/=maximum-minimum+1;if(power[bestBin]<mean*4)return none;
  const curvature=power[bestBin-1]-2*power[bestBin]+power[bestBin+1],offset=Math.abs(curvature)>1e-8?Math.max(-.5,Math.min(.5,.5*(power[bestBin-1]-power[bestBin+1])/curvature)):0;
  for(const band of [selected,1-selected]){
    let period=n/(bestBin+offset);const novelty=novelties[band],onsets=strongOnsets(novelty,Math.round(.12/dt)),fit=fitTempoPeriod(onsets,period,dt);
    if(fit&&Math.abs(fit/period-1)<.035)period=fit;
    const correlation=(lag:number,start=0,end=length)=>{let product=0,a=0,b=0;for(let i=start;i+lag<end;i++){const x=novelty[i],y=novelty[i+lag];product+=x*y;a+=x*x;b+=y*y;}return a*b>0?product/Math.sqrt(a*b):0;};
    const strength=correlation(Math.round(period));if(strength<.25)continue;
    let stable=true;
    for(let section=0;section<3;section++){
      const start=Math.floor(section*length/3),end=Math.floor((section+1)*length/3),count=2**Math.ceil(Math.log2(end-start))*4,r=new Float64Array(count),im=new Float64Array(count);
      r.set(novelty.subarray(start,end));fft(r,im);
      let target=0,background=0,bins=0;
      for(let bin=Math.ceil(60/60*count*dt);bin<=Math.floor(200/60*count*dt);bin++){const value=Math.hypot(r[bin],im[bin]);background+=value;bins++;if(Math.abs(bin/(count/period)-1)<.035)target=Math.max(target,value);}
      // Validate the chosen frequency in each section; syncopated accents need not own autocorrelation.
      if(target<background/Math.max(1,bins)*2.5){stable=false;break;}
    }
    if(!stable)continue;
    const bpm=60/(period*dt),confidence=Math.min(.74,.5+(strength-.35)*.35),onset=onsets[0]??0,phase=(onset*dt+size/2/sampleRate)%(60/bpm);
    return {status:'complete',confidence,candidates:[bpm,bpm/2,bpm*2].filter(value=>value>=30&&value<=400).map((value,index)=>({bpm:value,confidence:index?confidence*.72:confidence,firstBeatSeconds:phase}))};
  }
  return none;
}
