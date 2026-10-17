import type {BpmAnalysisSnapshot} from '../audio/types';
import {fitTempoPeriod,strongOnsets} from './tempo-fit';

/** Fit many onsets to a fractional pulse train, rather than one 5 ms lag bin. */
function refinePeriod(period:number,novelty:Float64Array):number {
  const bins=Math.ceil(period),folded=new Float64Array(bins);let best=period,bestPower=0;
  for(let candidate=period*.97;candidate<=period*1.03;candidate+=.04){
    folded.fill(0);
    for(let i=50;i<novelty.length;i++){const phase=(i%candidate)/candidate*bins,index=Math.floor(phase),weight=phase-index;folded[index]+=novelty[i]*(1-weight);folded[(index+1)%bins]+=novelty[i]*weight;}
    let peak=0;for(const value of folded)peak=Math.max(peak,value);
    const power=peak*candidate/(novelty.length-50);if(power>bestPower){bestPower=power;best=candidate;}
  }
  return best;
}

/** Tempo fallback for syncopated music. Its phase is deliberately unconfirmed. */
function estimateRhythmWindow(channels:readonly Float32Array[],sampleRate:number,spreadSeconds:number):BpmAnalysisSnapshot {
  const none:BpmAnalysisSnapshot={status:'unavailable',confidence:0,candidates:[]};
  if(!Number.isFinite(sampleRate)||sampleRate<8000||channels.length<1||channels.length>2||channels.some(c=>!(c instanceof Float32Array)||c.length!==channels[0].length)||channels[0].length<sampleRate*8)return none;
  const hop=Math.round(sampleRate/200),length=Math.floor(Math.min(channels[0].length,sampleRate*60)/hop);
  const envelopes=Array.from({length:3},()=>new Float64Array(length));
  const low=channels.map(()=>0),mid=channels.map(()=>0);
  const lowAlpha=1-Math.exp(-2*Math.PI*180/sampleRate),midAlpha=1-Math.exp(-2*Math.PI*2200/sampleRate);
  for(let h=0;h<length;h++){
    const power=[0,0,0];
    for(let frame=h*hop;frame<(h+1)*hop;frame++)for(let c=0;c<channels.length;c++){
      const value=Number.isFinite(channels[c][frame])?channels[c][frame]:0;
      low[c]+=lowAlpha*(value-low[c]);mid[c]+=midAlpha*(value-mid[c]);
      power[0]+=value*value;power[1]+=low[c]*low[c];power[2]+=(value-mid[c])**2;
    }
    for(let band=0;band<3;band++)envelopes[band][h]=Math.sqrt(power[band]/(hop*channels.length));
  }
  const energyDistribution=envelopes[0].slice(50).sort();
  const energyMean=energyDistribution.reduce((sum,value)=>sum+value,0)/energyDistribution.length;
  if(energyMean<1e-6||(energyDistribution[Math.floor(energyDistribution.length*.95)]-energyDistribution[Math.floor(energyDistribution.length*.1)])/energyMean<.12)return none;
  // Broad tempos can be fitted from clear onsets; ambiguous music retains the core pulse range.
  const dt=hop/sampleRate,minLag=Math.ceil(60/(200*dt)),maxLag=Math.floor(60/(60*dt));
  const options:{bpm:number;quality:number;phase:number}[]=[];
  for(const envelope of envelopes){
    const flux=new Float64Array(length);let mean=0,peak=0;
    for(let i=50;i<length;i++){flux[i]=Math.max(0,envelope[i]-envelope[i-1]);mean+=flux[i];peak=Math.max(peak,flux[i]);}
    mean/=length;
    const averageEnergy=envelope.reduce((sum,value)=>sum+value,0)/length;
    if(peak<Math.max(1e-5,averageEnergy*.08)||mean<1e-7)continue;
    // Positive novelty above its local average suppresses sustained notes and noise.
    const novelty=new Float64Array(length);let windowSum=0;
    for(let i=0;i<length;i++){windowSum+=flux[i];if(i>=40)windowSum-=flux[i-40];novelty[i]=Math.max(0,flux[i]-windowSum/Math.min(40,i+1));}
    // Musical attacks span several frames and do not land on identical 5 ms bins.
    // Triangular smoothing tolerates attack spread without relaxing confidence gates.
    const softened=new Float64Array(length);
    const radius=Math.round(spreadSeconds/dt),weight=(radius+1)**2;
    for(let i=0;i<length;i++)for(let offset=-radius;offset<=radius;offset++)softened[i]+=(novelty[i+offset]??0)*(radius+1-Math.abs(offset))/weight;
    novelty.set(softened);
    const score=(lag:number,start=0,end=length)=>{
      let product=0,a=0,b=0;for(let i=start;i+lag<end;i++){const x=novelty[i],y=novelty[i+lag];product+=x*y;a+=x*x;b+=y*y;}
      return a*b>0?product/Math.sqrt(a*b):0;
    };
    let lag=0,strength=0,rank=0;const scores=new Float64Array(maxLag+2);
    for(let candidate=minLag;candidate<=maxLag;candidate++){
      const correlation=score(candidate);scores[candidate]=correlation;
      const bpm=60/(candidate*dt),weighted=correlation*(1-.035*Math.abs(Math.log2(bpm/120)));
      if(weighted>rank){rank=weighted;strength=correlation;lag=candidate;}
    }
    if(strength<.35||lag===0)continue;
    const curvature=scores[lag-1]-2*scores[lag]+scores[lag+1];
    const offset=Math.abs(curvature)>1e-8?Math.max(-.5,Math.min(.5,.5*(scores[lag-1]-scores[lag+1])/curvature)):0;
    let period=fitTempoPeriod(strongOnsets(novelty,Math.round(.12/dt)),lag+offset,dt)??refinePeriod(lag+offset,novelty);
    lag=Math.round(period);
    let stable=true;
    for(let section=0;section<3;section++){
      const start=Math.floor(section*length/3),end=Math.floor((section+1)*length/3);let localLag=lag,localScore=0;
      for(let candidate=Math.max(minLag,Math.floor(lag*.8));candidate<=Math.min(maxLag,Math.ceil(lag*1.2));candidate++){const value=score(candidate,start,end);if(value>localScore){localScore=value;localLag=candidate;}}
      if(localScore<.28||Math.abs(localLag/period-1)>.035){stable=false;break;}
    }
    if(!stable)continue;
    let phase=0,phasePower=0;
    for(let candidate=0;candidate<lag;candidate++){let power=0;for(let beat=candidate;beat<length;beat+=period){const i=Math.round(beat);power+=novelty[i]??0;}if(power>phasePower){phasePower=power;phase=candidate;}}
    // Require every intermediate attack to be strong before unfolding skipped beats.
    for(const division of [4,3,2]){
      if(60*division/(period*dt)>240)continue;
      let supported=true;
      for(let part=1;part<division;part++){let power=0;for(let beat=phase+period*part/division;beat<length;beat+=period)power+=novelty[Math.round(beat)]??0;if(power<phasePower*.82){supported=false;break;}}
      if(supported&&score(Math.round(period/division))>=strength*.78){period=refinePeriod(period/division,novelty);break;}
    }
    const bpm=60/(period*dt);if(bpm<40||bpm>240)continue;
    options.push({bpm,quality:strength,phase:(phase*dt)%(60/bpm)});
  }
  options.sort((a,b)=>b.quality-a.quality);const best=options[0];if(!best)return none;
  // Never silently authorize quantize/sync using a tempo-only estimate.
  const confidence=Math.min(.74,.5+(best.quality-.35)*.35);
  const candidates=options.filter((option,index)=>options.slice(0,index).every(other=>Math.abs(other.bpm/option.bpm-1)>.012)).map(option=>({bpm:option.bpm,confidence:Math.min(.74,.5+(option.quality-.35)*.35),firstBeatSeconds:option.phase}));
  for(const bpm of [best.bpm/2,best.bpm*2])if(bpm>=30&&bpm<=400&&candidates.every(c=>Math.abs(c.bpm/bpm-1)>.012))candidates.push({bpm,confidence:confidence*.72,firstBeatSeconds:best.phase});
  return {status:'complete',confidence,candidates};
}

export function estimateRhythm(channels:readonly Float32Array[],sampleRate:number):BpmAnalysisSnapshot {
  // Prefer detailed transients; widen timing tolerance only when they yield no stable tempo.
  const precise=estimateRhythmWindow(channels,sampleRate,.01);
  return precise.status==='complete'?precise:estimateRhythmWindow(channels,sampleRate,.02);
}
