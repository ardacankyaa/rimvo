/** A tempo fit is not proof of beat phase; callers retain their confidence checks. */
export function fitTempoPeriod(peaks:readonly number[],seed:number,hopSeconds:number):number|null {
  if(peaks.length<8||!Number.isFinite(seed)||seed<=0)return null;
  const intervals=peaks.slice(1).map((value,index)=>value-peaks[index]).sort((a,b)=>a-b);
  const median=intervals[Math.floor(intervals.length/2)],division=Math.round(seed/median);
  let period=seed;
  if(division>=2&&division<=6&&Math.abs(seed/median/division-1)<.04)period/=division;
  const origin=peaks[0],beats=peaks.map(value=>Math.round((value-origin)/period));
  const xMean=beats.reduce((sum,x)=>sum+x,0)/beats.length,yMean=peaks.reduce((sum,y)=>sum+y,0)/peaks.length;
  let covariance=0,variance=0;
  for(let i=0;i<peaks.length;i++){covariance+=(beats[i]-xMean)*(peaks[i]-yMean);variance+=(beats[i]-xMean)**2;}
  if(variance===0)return null;
  const fitted=covariance/variance,offset=yMean-fitted*xMean;
  let error=0;for(let i=0;i<peaks.length;i++)error+=(peaks[i]-offset-beats[i]*fitted)**2;
  const rms=Math.sqrt(error/peaks.length)*hopSeconds;
  return fitted>0&&Math.abs(fitted/period-1)<.035&&rms<Math.min(.035,fitted*hopSeconds*.08)?fitted:null;
}

export function strongOnsets(signal:Float64Array,spacing:number):number[]{
  let peak=0;for(const value of signal)peak=Math.max(peak,value);
  const result:number[]=[];
  for(let i=1;i+1<signal.length;i++){
    if(signal[i]<peak*.35||signal[i]<signal[i-1]||signal[i]<signal[i+1])continue;
    const last=result.at(-1);if(last!==undefined&&i-last<spacing){if(signal[i]>signal[last])result[result.length-1]=i;}else result.push(i);
  }
  return result;
}
