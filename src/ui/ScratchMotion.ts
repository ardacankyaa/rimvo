export interface ScratchAnchor { angle:number; parked:boolean }
export function smoothScratchVelocity(previous:number,deltaSeconds:number,elapsedSeconds:number):number {
  if(!Number.isFinite(deltaSeconds)||!Number.isFinite(elapsedSeconds)||elapsedSeconds<=0||deltaSeconds===0)return 0;
  const target=Math.max(-2,Math.min(2,deltaSeconds/Math.max(.004,elapsedSeconds)));
  // A direction change follows the hand immediately; a same-direction gesture rejects sample jitter.
  const alpha=previous*target<0?1:1-Math.exp(-elapsedSeconds/.012);
  return previous+(target-previous)*alpha;
}
export function createScratchAnchor(x:number,y:number,radius:number):ScratchAnchor{
  return {angle:Math.atan2(y,x),parked:Math.hypot(x,y)<radius*0.14};
}
export function sampleScratchMotion(anchor:ScratchAnchor,x:number,y:number,radius:number):number{
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(radius)||radius<=0)return 0;
  const distance=Math.hypot(x,y),angle=Math.atan2(y,x);
  if(distance<radius*0.14){anchor.parked=true;return 0;}
  if(anchor.parked){
    if(distance>radius*0.20){anchor.angle=angle;anchor.parked=false;}
    return 0;
  }
  const delta=((angle-anchor.angle+3*Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  anchor.angle=angle;
  return delta;
}
