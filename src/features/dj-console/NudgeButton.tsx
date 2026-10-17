import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeckId } from '../../audio/types';
import { engine, getSnapshot } from '../../state/engine';
import { registerGesture } from '../../ui/gesture-registry';
import { Icon } from '../../ui/Icon';

export function NudgeButton({id,direction,enabled,revision,run}:{id:DeckId;direction:-1|1;enabled:boolean;revision:number;run:(action:()=>void|Promise<unknown>)=>void}) {
  const button=useRef<HTMLButtonElement>(null);
  const active=useRef<{pointerId:number|null;revision:number;unregister:()=>void}|null>(null);
  const [held,setHeld]=useState(false);
  const finishRef=useRef<()=>void>(()=>{});
  function finish(pointerId?:number){
    const gesture=active.current;if(!gesture||(pointerId!==undefined&&gesture.pointerId!==pointerId))return;
    active.current=null;gesture.unregister();setHeld(false);
    if(gesture.pointerId!==null)try{button.current?.releasePointerCapture(gesture.pointerId);}catch{/* Already released. */}
    const current=getSnapshot();
    if(current.decks[id].revision===gesture.revision&&current.decks[id].track&&current.contextState==='running')run(()=>engine.endNudge(id));
  }
  useLayoutEffect(()=>{finishRef.current=finish;});
  useEffect(()=>()=>finishRef.current(),[]);
  useEffect(()=>{if(!enabled||active.current?.revision!==revision)finishRef.current();},[enabled,revision]);
  function begin(pointerId:number|null){
    if(!enabled||active.current)return;
    active.current={pointerId,revision,unregister:registerGesture(()=>finishRef.current())};setHeld(true);
    run(()=>engine.beginNudge(id,direction*4));
  }
  return <button ref={button} type="button" className={held?'is-held':''} aria-label={'Nudge '+(direction<0?'backward ':'forward ')+id} aria-pressed={held} disabled={!enabled} title={'Hold to temporarily '+(direction<0?'slow down':'speed up')+' this record'}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});begin(event.pointerId);if(active.current)try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Global blur cleanup remains available. */}}}
    onPointerUp={event=>finish(event.pointerId)} onPointerCancel={event=>finish(event.pointerId)} onLostPointerCapture={event=>finish(event.pointerId)}
    onBlur={()=>{if(active.current?.pointerId===null)finish();}}
    onKeyDown={event=>{if(event.code==='Space'||event.key==='Enter'){event.preventDefault();if(!event.repeat)begin(null);}if(event.key==='Escape')finish();}}
    onKeyUp={event=>{if(event.code==='Space'||event.key==='Enter'){event.preventDefault();finish();}}}
    onClick={event=>{if(event.detail===0&&!active.current)run(()=>engine.nudgeDeck(id,direction*4));}}>
    <Icon name={direction<0?'left':'right'}/><span className="visually-hidden">{held?'Temporary '+(direction<0?'slowdown':'speedup'):'Hold to bend tempo'}</span>
  </button>;
}
