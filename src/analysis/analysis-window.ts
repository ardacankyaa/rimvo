export const TEMPO_SAMPLE_RATE=44100;

/** Test original broadband energy before resampling can reshape noise. */
export function hasRhythmicEnergy(channels:readonly Float32Array[],sampleRate:number):boolean {
  const frames=Math.floor(channels[0].length/(sampleRate/200)),values=new Float64Array(Math.max(0,frames-50));let peak=0,sum=0;
  for(let hop=50;hop<frames;hop++){
    const start=Math.floor(hop*sampleRate/200),end=Math.floor((hop+1)*sampleRate/200);let power=0;
    for(const channel of channels)for(let i=start;i<end;i++){const value=channel[i];if(Number.isFinite(value))power+=value*value;}
    const energy=Math.sqrt(power/((end-start)*channels.length));values[hop-50]=energy;sum+=energy;peak=Math.max(peak,energy);
  }
  if(!values.length)return false;
  const mean=sum/values.length;if(mean<1e-6)return false;
  if(peak>mean*4)return true;
  values.sort();return (values[Math.floor(values.length*.95)]-values[Math.floor(values.length*.1)])/mean>.2;
}

/** Bounded per-window scratch PCM, never a second whole-track cache. */
export function tempoWindow(channels:readonly Float32Array[],sampleRate:number):readonly Float32Array[]{
  if(sampleRate===TEMPO_SAMPLE_RATE)return channels;
  const ratio=sampleRate/TEMPO_SAMPLE_RATE,count=Math.floor(channels[0].length/ratio);
  const result=channels.map(()=>new Float32Array(count));
  for(let i=0;i<count;i++){
    const start=i*ratio,end=(i+1)*ratio,first=Math.floor(start),last=Math.ceil(end);
    for(let c=0;c<channels.length;c++){
      let sum=0;
      for(let frame=first;frame<last;frame++){const weight=Math.min(end,frame+1)-Math.max(start,frame),value=channels[c][frame];if(Number.isFinite(value))sum+=value*weight;}
      result[c][i]=sum/ratio;
    }
  }
  return result;
}
