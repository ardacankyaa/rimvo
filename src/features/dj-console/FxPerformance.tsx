import { t } from '../../i18n';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DeckId } from '../../audio/types';
import { FxHoldControl, fxLabels, type DeckFx, type FxWrite, type FxType } from './FxPads';
import { registerGesture } from '../../ui/gesture-registry';
import { engine, getSnapshot } from '../../state/engine';
import { createTemporaryFxGesture, permanentFxEnabled } from './transition-gesture';

const effects: FxType[] = ['delay','reverb','flanger','tremolo','drive'];
const effectFeels: Record<FxType,string> = {delay:'Repeats',reverb:'Reverb space',flanger:'Sweep',tremolo:'Pulse',drive:'Grit'};
const effectHints: Record<FxType,string> = {delay:'Leave a trail of repeats',reverb:'Give the track more space',flanger:'Sweep through the sound',tremolo:'Make the volume pulse',drive:'Add a little grit'};
const shapes: Record<FxType,string> = {delay:'M2 17h4v-9h4v7h4v-5h4v3h4',reverb:'M2 16q4-16 8 0t8 0l4-4',flanger:'M2 12q5-13 10 0t10 0M2 12q5 13 10 0t10 0',tremolo:'M2 18V6h5v12h5V6h5v12h5',drive:'M2 18l6-12h8l6 12'};
function responsePath(type:FxType,amount:number,variation:number):string {
  return Array.from({length:81},(_,i)=>{
    const t=i/80,phase=t*Math.PI*2*(2+variation*5),amplitude=5+amount*24;
    const wave=type==='drive'?Math.tanh(Math.sin(t*Math.PI*2)*(1+amount*8)):type==='delay'?Math.sin(t*Math.PI*12)*Math.exp(-t*(4-variation*3)):type==='reverb'?Math.sin(t*Math.PI*24)*Math.exp(-t*2):type==='tremolo'?Math.sin(phase):Math.sin(phase)*Math.cos(t*Math.PI*2);
    return (i?'L':'M')+(t*240).toFixed(1)+' '+(35-wave*amplitude).toFixed(1);
  }).join(' ');
}

export function FxPerformance({id,value,loaded,onChange}: {id:DeckId;value:DeckFx;loaded:boolean;onChange:(setting:FxWrite)=>void}) {
  const [selected,setSelected] = useState<FxType>('delay');
  const pad = useRef<HTMLDivElement>(null);
  const active = useRef<{pointerId:number;rect:DOMRect;unregister:()=>void}|null>(null);
  const heldFx = useRef<ReturnType<typeof createTemporaryFxGesture>|null>(null);
  const live = useRef({selected,onChange});
  useLayoutEffect(()=>{live.current={selected,onChange};});
  const setting=value[selected];
  const amount = selected==='delay'?value.delay.wet/.5:selected==='reverb'?value.reverb.wet/.4:value[selected].amount;
  const variation = selected==='delay'?value.delay.feedback/.6:selected==='flanger'||selected==='tremolo'?(Math.log(value[selected].rate/.1)/Math.log(80)):.5;
  function write(enabled:boolean,x?:number,y?:number) {
    const {selected:type,onChange}=live.current;
    const fx=getSnapshot().decks[id].fx;
    const change=(setting:FxWrite)=>{if(heldFx.current){if(!heldFx.current.move(setting))finish();}else onChange(setting);};
    if(type==='delay')change({type,...fx.delay,enabled,...(x===undefined?{}:{wet:x*.5}),...(y===undefined?{}:{feedback:y*.6})});
    else if(type==='reverb')change({type,...fx.reverb,enabled,...(x===undefined?{}:{wet:x*.4})});
    else if(type==='drive')change({type,...fx.drive,enabled,...(x===undefined?{}:{amount:x})});
    else change({type,...fx[type],enabled,...(x===undefined?{}:{amount:x}),...(y===undefined?{}:{rate:.1*80**y})});
  }
  function beginFx() {
    const {selected:type,onChange:change}=live.current;
    heldFx.current=createTemporaryFxGesture(engine,id,type,false,change);
    write(true);
  }
  function finishFx() {
    const model=heldFx.current;heldFx.current=null;model?.finish();
  }
  function adjust(x?:number,y?:number) {
    const enabled=permanentFxEnabled(engine,id,live.current.selected);
    finish();
    finishFx();
    write(enabled,x,y);
  }
  function finish(pointerId?:number) {
    const gesture=active.current;if(!gesture||(pointerId!==undefined&&gesture.pointerId!==pointerId))return;active.current=null;gesture.unregister();
    try { pad.current?.releasePointerCapture(gesture.pointerId); } catch { /* Capture may already be gone. */ }
    finishFx();
  }
  const cleanupRef=useRef(()=>{finish();finishFx();});
  useLayoutEffect(()=>{cleanupRef.current=()=>{finish();finishFx();};});
  useEffect(()=>()=>cleanupRef.current(),[]);
  useEffect(()=>{if(!loaded)cleanupRef.current();},[loaded]);
  function move(event:ReactPointerEvent<HTMLDivElement>) {
    const gesture=active.current;if(!gesture || gesture.pointerId!==event.pointerId)return;
    const x=Math.max(0,Math.min(1,(event.clientX-gesture.rect.left)/gesture.rect.width));
    const y=Math.max(0,Math.min(1,1-(event.clientY-gesture.rect.top)/gesture.rect.height));
    write(true,x,y);
  }
  return <section className="fx-performance" aria-label={t('Performance effects '+id)}>
    <div className="fx-picker" role="group" aria-label={t('Choose effect '+id)}>{effects.map(type=><button key={type} type="button" aria-pressed={selected===type} aria-label={t('Select '+fxLabels[type]+' '+id)} title={t(effectHints[type])} onClick={()=>{finish();setSelected(type);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={shapes[type]} /></svg><span>{t(fxLabels[type])}</span><small>{t(effectFeels[type])}</small><i className={value[type].enabled?'is-on':''} /></button>)}</div>
    <div ref={pad} className={'fx-surface'+(setting.enabled?' is-performing':'')} role="group" tabIndex={-1} aria-label={t(fxLabels[selected]+' gesture pad '+id)} aria-disabled={!loaded}
      style={{'--fx-x':amount*100+'%','--fx-y':(1-variation)*100+'%'} as React.CSSProperties}
      onPointerDown={event=>{if(!loaded||event.button!==0||active.current)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Central blur cleanup remains available. */}active.current={pointerId:event.pointerId,rect:event.currentTarget.getBoundingClientRect(),unregister:registerGesture(finish)};beginFx();move(event);}}
      onPointerMove={move} onPointerUp={event=>finish(event.pointerId)} onPointerCancel={event=>finish(event.pointerId)} onLostPointerCapture={event=>finish(event.pointerId)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();finish();}}}>
      <svg className="fx-response" viewBox="0 0 240 70" aria-hidden="true"><path d={responsePath(selected,amount,variation)} /></svg>
      <i className="fx-cursor" /><span className="fx-surface__hint">{t(setting.enabled?fxLabels[selected]+' · Live':'Hold & move · '+effectFeels[selected])}</span>
    </div>
    <div className="fx-near-controls"><label>{t("Amount")}<input aria-label={t('FX amount '+id)} type="range" min="0" max="1" step="0.01" value={amount} disabled={!loaded} onChange={event=>adjust(Number(event.currentTarget.value))} /></label>
      {selected!=='drive'&&selected!=='reverb'&&<label>{t(selected==='delay'?'Feedback':'Speed')}<input aria-label={t('FX variation '+id)} type="range" min="0" max="1" step="0.01" value={variation} disabled={!loaded} onChange={event=>adjust(undefined,Number(event.currentTarget.value))} /></label>}
    </div>
    <FxHoldControl key={selected} id={id} type={selected} enabled={setting.enabled} loaded={loaded} latched={permanentFxEnabled(engine,id,selected)} onLatch={next=>{finish();finishFx();write(next);}} onHoldStart={beginFx} onHoldEnd={finishFx} />
  </section>;
}
