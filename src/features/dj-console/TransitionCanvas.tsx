import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AudioSnapshot } from '../../audio/types';
import { engine, getSnapshot } from '../../state/engine';
import { registerGesture } from '../../ui/gesture-registry';
import { createTransitionGesture, type TransitionScene } from './transition-gesture';
import { Icon } from '../../ui/Icon';

const scenes: readonly { id: TransitionScene; name: string; hint: string; path: string }[] = [
  {id:'air',name:'Air',hint:'Open up the space',path:'M3 16q9-18 18 0M6 17q6-11 12 0'},
  {id:'echo',name:'Echo',hint:'Leave a trail behind',path:'M3 6v12m6-10v8m6-6v4m6-3v2'},
  {id:'sweep',name:'Sweep',hint:'Lift the outgoing track',path:'M3 19Q10 19 12 12T21 5'},
];
type Gesture = { model: NonNullable<ReturnType<typeof createTransitionGesture>>; pointerId: number | null; rect: DOMRect | null; unregister: () => void };

export function TransitionCanvas({ snapshot, run, onLearn, onComplete }: { snapshot: AudioSnapshot; run: (action: () => void | Promise<unknown>) => void; onLearn: () => void; onComplete: () => void }) {
  const [scene,setScene] = useState<TransitionScene>('air');
  const [performing,setPerforming] = useState(false);
  const [point,setPoint] = useState({x:snapshot.mixer.crossfader,y:0});
  const [trace,setTrace] = useState<string[]>([]);
  const surface=useRef<HTMLButtonElement>(null);
  const active=useRef<Gesture|null>(null);
  const position=useRef(point);
  const mounted=useRef(true);
  const travelled=useRef(0);
  const ready=Boolean(snapshot.decks.A.track && snapshot.decks.B.track) && !['closed','disposed','faulted'].includes(snapshot.contextState);

  function finish(cancel=false,pointerId?:number) {
    const gesture=active.current;
    if (!gesture || (pointerId!==undefined && gesture.pointerId!==pointerId)) return;
    active.current=null;
    gesture.unregister();
    if(gesture.pointerId!==null)try{surface.current?.releasePointerCapture(gesture.pointerId);}catch{/* Already released by the browser. */}
    run(()=>gesture.model.finish(cancel));
    const current=getSnapshot();
    if(!cancel && travelled.current >= 0.2 && current.contextState==='running' && current.decks.A.status==='playing' && current.decks.B.status==='playing')onComplete();
    if(mounted.current){setPerforming(false);setPoint({x:getSnapshot().mixer.crossfader,y:0});}
  }
  const finishRef=useRef(finish);useLayoutEffect(()=>{finishRef.current=finish;});
  useEffect(()=>{
    mounted.current=true;
    const resize=()=>finishRef.current(true);
    window.addEventListener('resize',resize);
    return()=>{mounted.current=false;window.removeEventListener('resize',resize);finishRef.current(true);};
  },[]);
  useEffect(()=>{finishRef.current(true);},[snapshot.decks.A.revision,snapshot.decks.B.revision,snapshot.contextState]);

  function start(pointerId:number|null,rect:DOMRect|null) {
    if(active.current || !ready)return false;
    const model=createTransitionGesture(engine,scene);
    if(!model)return false;
    active.current={model,pointerId,rect,unregister:registerGesture(()=>finishRef.current(true))};
    travelled.current=0;position.current={x:getSnapshot().mixer.crossfader,y:0};
    setTrace([]);setPerforming(true);
    return true;
  }
  function move(x:number,y:number) {
    const gesture=active.current;if(!gesture)return;
    const next={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
    run(()=>{if(!gesture.model.move(next.x,next.y))finishRef.current(true);});
    if(!active.current)return;
    travelled.current+=Math.abs(position.current.x-next.x)+Math.abs(position.current.y-next.y);
    position.current=next;setPoint(next);
    setTrace(points=>[...points.slice(-63),(next.x*240).toFixed(1)+','+((1-next.y)*120).toFixed(1)]);
  }
  function pointerMove(event:ReactPointerEvent<HTMLButtonElement>) {
    const gesture=active.current;if(!gesture?.rect||gesture.pointerId!==event.pointerId)return;
    move((event.clientX-gesture.rect.left)/gesture.rect.width,1-(event.clientY-gesture.rect.top)/gesture.rect.height);
  }
  const visibleX=performing?point.x:snapshot.mixer.crossfader;
  return <section className="transition-canvas" aria-label="Transition canvas">
    <div className="transition-canvas__toolbar"><div className="transition-scenes" role="group" aria-label="Transition character">{scenes.map(item=><button key={item.id} type="button" aria-label={item.name+' transition'} aria-pressed={scene===item.id} title={item.hint} onClick={()=>{finish(true);setScene(item.id);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.path}/></svg>{item.name}</button>)}</div><button className="transition-learn" type="button" aria-label="Guided mix missions" title="Guided mix · learn by doing" onClick={onLearn}><Icon name="question" /></button></div>
    <button ref={surface} type="button" className={'transition-surface'+(performing?' is-performing':'')} aria-label="Draw your transition" aria-describedby="transition-instructions" aria-pressed={performing} disabled={!ready}
      style={{'--canvas-x':visibleX*100+'%','--canvas-y':(1-point.y)*100+'%'} as React.CSSProperties}
      onPointerDown={event=>{if(event.button!==0||active.current)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});if(!start(event.pointerId,event.currentTarget.getBoundingClientRect()))return;try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Blur and cancellation still clean up the gesture. */}pointerMove(event);}}
      onPointerMove={pointerMove} onPointerUp={event=>finish(false,event.pointerId)} onPointerCancel={event=>finish(true,event.pointerId)} onLostPointerCapture={event=>finish(true,event.pointerId)}
      onKeyDown={event=>{if(event.code==='Space'){event.preventDefault();if(!event.repeat&&start(null,null))move(snapshot.mixer.crossfader,0.35);}else if(event.key==='Escape'){event.preventDefault();finish(true);}else if(active.current?.pointerId===null&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const step=event.shiftKey ? .01 : .05;move(position.current.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),position.current.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0));}}}
      onKeyUp={event=>{if(event.code==='Space'){event.preventDefault();finish();}}} onBlur={()=>{if(active.current?.pointerId===null)finish(true);}}>
      <svg className="transition-trace" viewBox="0 0 240 120" preserveAspectRatio="none" aria-hidden="true"><path className="transition-guide" d="M10 110C65 110 70 20 120 20S175 110 230 110"/><polyline points={trace.join(' ')}/></svg>
      <span className="transition-axis transition-axis--a" aria-hidden="true">A</span><span className="transition-axis transition-axis--b" aria-hidden="true">B</span>
      <span className="transition-surface__character" aria-hidden="true">{scenes.find(item=>item.id===scene)?.hint}</span>
      <i className="transition-cursor" aria-hidden="true"/>
      <svg className="transition-gesture-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 19h20M6 19l4-4m-4 4 4 4m16-4-4-4m4 4-4 4M16 19V5m0 0-4 4m4-4 4 4" /></svg>
      <span className="transition-surface__hint">{!ready?'Add two tracks':performing?'Mixing':'Drag to mix'}</span>
    </button>
    <span id="transition-instructions" className="visually-hidden">Hold and drag: left/right blends A and B, up adds the chosen effect. Release restores your previous tone and effect settings and keeps the blend. Hold Space and use arrow keys on the keyboard. Escape cancels and restores the blend too.</span>
  </section>;
}
