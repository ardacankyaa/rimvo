import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {DeckId,DeckSnapshot} from '../../audio/types';
import {engine,getSnapshot} from '../../state/engine';
import {noteNames,shiftedNote,pitchForTarget} from '../../analysis/key-analysis';
import {Knob} from '../../ui/ControlPrimitives';
import {cancelAllGestures} from '../../ui/gesture-registry';

export function BpmControl({id,deck,run,openTrackBpmRequest}:{id:DeckId;deck:DeckSnapshot;run:(action:()=>void|Promise<unknown>)=>void;openTrackBpmRequest?:number}){
  const [editingGrid,setEditingGrid]=useState(false),[draftRecord,setDraft]=useState<{revision:number|undefined;value:string}|null>(null);
  const [showBpm,setShowBpm]=useState(false);
  const [tapFeedback,setTapFeedback]=useState<{revision:number|undefined;count:number}>({revision:undefined,count:0});
  const popup=useRef<HTMLDetailsElement>(null),taps=useRef<number[]>([]);
  const [lastOpenRequest,setLastOpenRequest]=useState(openTrackBpmRequest);
  const lastDomOpenRequest=useRef(openTrackBpmRequest);
  const base=deck.beatGrid?.bpm,key=deck.track?.keyAnalysis,revision=deck.track?.revision;
  const draft=draftRecord?.revision===revision?draftRecord?.value:null;
  const tapRevision=useRef(revision),tapCount=tapFeedback.revision===revision?tapFeedback.count:0;
  const linked=deck.pitchMode!=='independent';
  const nominalShift=linked?12*Math.log2(1+deck.tempoPercent/100):deck.pitchSemitones;
  const audibleShift=linked?12*Math.log2((1+deck.tempoPercent/100)*(1+deck.nudgePercent/100)):deck.pitchSemitones;
  const note=shiftedNote(key,audibleShift),estimated=deck.beatGrid?.source==='auto'&&deck.beatGrid.confidence<.75;
  const liveBpm=deck.effectiveBpm===null?null:deck.effectiveBpm*(1+deck.nudgePercent/100);
  const analyzing=deck.status==='loading'||deck.bpmAnalysis.status==='analyzing';
  const detected=deck.bpmAnalysis.status==='complete'?deck.bpmAnalysis.candidates[0]:undefined;
  const canRestoreDetected=!!deck.track&&!!detected&&Number.isFinite(detected.bpm)&&detected.bpm>=30&&detected.bpm<=300&&Number.isFinite(detected.firstBeatSeconds)&&detected.firstBeatSeconds>=0&&detected.firstBeatSeconds<deck.durationSeconds;
  const canClearManualBpm=!!deck.track&&!canRestoreDetected&&(deck.beatGrid?.source==='manual'||deck.beatGrid?.source==='tap');
  const target=key?.tonic==null?'':String((key.tonic+Math.round(nominalShift)+24)%12);
  if(lastOpenRequest!==openTrackBpmRequest){
    setLastOpenRequest(openTrackBpmRequest);
    const currentDeck=getSnapshot().decks[id];
    if(openTrackBpmRequest!==undefined&&revision!==undefined&&currentDeck.track?.revision===revision&&currentDeck.revision===revision){
      setShowBpm(true);setEditingGrid(true);setDraft(null);
    }
  }
  function positionPopup(){
    const owner=popup.current,menu=owner?.querySelector<HTMLElement>('.bpm-popover');if(!owner?.open||!menu)return;
    const rect=owner.getBoundingClientRect(),trigger=owner.querySelector('summary')!.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    let left=trigger.left-width-10;
    if(left<8&&trigger.right+10+width<=innerWidth-8)left=trigger.right+10;
    left=Math.max(8,Math.min(left,innerWidth-width-8));
    let top=trigger.bottom+8;
    if(top+height>innerHeight-8&&trigger.top-height-8>=8)top=trigger.top-height-8;
    top=Math.max(8,Math.min(top,innerHeight-height-8));
    menu.style.left=(left-rect.left)+'px';menu.style.right='auto';
    owner.style.setProperty('--bpm-offset',(top-rect.top)+'px');
  }
  useLayoutEffect(()=>{
    if(lastDomOpenRequest.current===openTrackBpmRequest)return;
    lastDomOpenRequest.current=openTrackBpmRequest;
    const currentDeck=getSnapshot().decks[id];
    if(openTrackBpmRequest===undefined||revision===undefined||currentDeck.track?.revision!==revision||currentDeck.revision!==revision)return;
    if(popup.current)popup.current.open=true;
    positionPopup();
    popup.current?.querySelector<HTMLInputElement>('[aria-label="Track BPM '+id+'"]')?.focus({preventScroll:true});
  },[openTrackBpmRequest,id,revision]);
  useLayoutEffect(()=>{positionPopup();},[editingGrid,showBpm,deck.pitchMode]);
  useEffect(()=>{window.addEventListener('resize',positionPopup);return()=>window.removeEventListener('resize',positionPopup);},[]);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(event.pointerType==='touch'&&!event.isPrimary)return;if(popup.current?.open&&!popup.current.contains(event.target as Node))popup.current.open=false;};document.addEventListener('pointerdown',close,true);return()=>document.removeEventListener('pointerdown',close,true);},[]);
  const current=()=>revision!==undefined&&getSnapshot().decks[id].track?.revision===revision&&getSnapshot().decks[id].revision===revision;
  function pitch(value:number){if(current())run(()=>engine.setPitchSemitones(id,value));}
  function apply(value:number){if(!current()||!Number.isFinite(value)||draft?.trim()==='')return;run(()=>{if(editingGrid||!base)engine.setBeatGrid(id,{bpm:Math.max(30,Math.min(300,value)),firstBeatSeconds:deck.beatGrid?.firstBeatSeconds??0});else return engine.setTempo(id,Math.max(-16,Math.min(16,(value/base-1)*100)));});setDraft(null);}
  function correctTrackBpm(value:number){if(!current())return;run(()=>engine.setBeatGrid(id,{bpm:value,firstBeatSeconds:deck.beatGrid?.firstBeatSeconds??0}));setDraft(null);}
  function tap(){if(tapRevision.current!==revision){tapRevision.current=revision;taps.current=[];}const now=performance.now();taps.current=[...taps.current.filter(t=>now-t<4000),now].slice(-5);setTapFeedback({revision,count:Math.min(4,taps.current.length)});if(taps.current.length<4)return;const intervals=taps.current.slice(1).map((t,i)=>t-taps.current[i]).filter(t=>t>=200&&t<=2000).sort((a,b)=>a-b);if(intervals.length>=3&&current()){run(()=>engine.setBeatGrid(id,{bpm:60000/intervals[Math.floor(intervals.length/2)],firstBeatSeconds:engine.readPosition(id).positionSeconds}));setDraft(null);}}
  return <details ref={popup} className={'bpm-control'+(deck.nudgePercent?' is-nudging':'')+(analyzing?' is-analyzing':'')} onToggle={()=>{if(popup.current?.open){if(!base){setShowBpm(true);setEditingGrid(true);}document.querySelectorAll<HTMLDetailsElement>('.bpm-control[open]').forEach(other=>{if(other!==popup.current)other.open=false;});}positionPopup();}} onKeyDown={event=>{if(event.key==='Escape'&&popup.current?.open){cancelAllGestures();popup.current.open=false;popup.current.querySelector('summary')?.focus();event.preventDefault();event.stopPropagation();}}}>
    <summary aria-label={'Adjust BPM '+id} title={analyzing?'Finding the rhythm':liveBpm===null&&deck.track?'No steady rhythm found. Tap to set BPM.':'Speed & tone'}><output aria-label={'Current BPM '+id}>{liveBpm!==null?(estimated?'~':'')+liveBpm.toFixed(1):analyzing?'…':deck.track?'Tap':'—'}</output><small>{deck.nudgePercent?(deck.nudgePercent>0?'↑ +':'↓ ')+deck.nudgePercent.toFixed(0)+'%':analyzing?'Finding BPM':note?'~'+note:liveBpm===null&&deck.track?'Find BPM':'BPM'}</small></summary>
    <div className="bpm-popover tuning-popover">
      <div className="tuning-heading"><strong>Adjust {id}</strong><button type="button" aria-label={'Close tuning '+id} onClick={()=>{if(popup.current){popup.current.open=false;popup.current.querySelector('summary')?.focus();}}}>×</button></div>
      <div className="tuning-pages" role="group" aria-label={'Track controls '+id}><button type="button" aria-label="Back to tuning" aria-pressed={!showBpm||!editingGrid} onClick={()=>{setShowBpm(false);setDraft(null);}}>Speed & tone</button><button type="button" aria-label="Track BPM" aria-pressed={showBpm&&editingGrid} onClick={()=>{setShowBpm(true);setEditingGrid(true);setDraft(null);}}>Track BPM</button></div>
      <div className="tempo-comparison"><span>Track BPM <output aria-label={'Original BPM '+id}>{base?.toFixed(1)??'—'}</output></span><span>Playing BPM <button type="button" aria-label="Playback" title="Set playing BPM" disabled={!base} onClick={()=>{setShowBpm(true);setEditingGrid(false);setDraft(null);}}>{liveBpm?.toFixed(1)??'—'}<span aria-hidden="true">↗</span></button></span></div>
      <div hidden={showBpm}>
        <div className="tuning-link" role="group" aria-label={'Speed and tone mode '+id}>{(['independent','linked'] as const).map(mode=><button key={mode} type="button" aria-label={(mode==='linked'?'Link speed and tone ':'Separate speed and tone ')+id} aria-pressed={mode==='linked'?linked:!linked} disabled={!deck.track} onClick={()=>run(()=>engine.setPitchMode(id,mode))}>{mode==='linked'?'Link tone':'Keep tone'}</button>)}</div>
        <div className="tuning-knobs">
          <div><span className="tuning-label">Speed</span><Knob label={'Speed knob '+id} displayLabel="" value={deck.tempoPercent} min={-16} max={16} step={.1} defaultValue={0} disabled={!deck.track} valueText={v=>(v>0?'+':'')+v.toFixed(1)+'%'} onChange={v=>{if(current())run(()=>engine.setTempo(id,v));}}/></div>
          <div><button className="tuning-label" type="button" aria-label={'Tone settings '+id} onClick={()=>popup.current?.querySelector<HTMLElement>('[aria-label="Tone semitones '+id+'"]')?.focus()}>Tone</button><Knob label={'Tone semitones '+id} displayLabel="" value={nominalShift} min={-12} max={12} step={.1} defaultValue={0} disabled={!deck.track||linked} valueText={v=>(v>0?'+':'')+v.toFixed(1)+' st'} onChange={pitch}/></div>
        </div>
        <label className="tuning-note">Note <select aria-label={'Target note '+id} value={target} disabled={!deck.track||target===''||linked} title="Estimated root; major/minor stays unchanged" onChange={event=>{if(key?.tonic!=null)pitch(pitchForTarget(key.tonic,Number(event.currentTarget.value),nominalShift));}}>{target===''&&<option value="">Unknown</option>}{noteNames.map((name,index)=><option key={name} value={index}>{name}</option>)}</select><span>{note?'~'+note:'—'}</span></label>
        <div className="bpm-actions"><button type="button" disabled={!deck.track||linked} onClick={()=>pitch(0)}>Reset tone</button><button type="button" disabled={!deck.track||linked||key?.tonic==null||getSnapshot().decks[id==='A'?'B':'A'].track?.keyAnalysis?.tonic==null} onClick={()=>{const other=getSnapshot().decks[id==='A'?'B':'A'];const shift=other.pitchMode==='independent'?other.pitchSemitones:12*Math.log2(1+other.tempoPercent/100);if(key?.tonic!=null&&other.track?.keyAnalysis?.tonic!=null)pitch(pitchForTarget(key.tonic,(other.track.keyAnalysis.tonic+Math.round(shift)+24)%12,nominalShift));}}>Match note</button></div>
        <p>{linked?'Speed changes BPM and tone together.':'Speed changes BPM. Tone changes the note.'}</p>
      </div>
      <div hidden={!showBpm}>
        <form onSubmit={event=>{event.preventDefault();apply(Number(draft??(editingGrid?base:deck.effectiveBpm)??NaN));}}><label>{editingGrid?'Correct track BPM':'Set playing BPM'}<input aria-label={(editingGrid?'Track BPM ':'Playback BPM ')+id} type="number" required min={editingGrid?30:base?Math.ceil(base*.84*10)/10:30} max={editingGrid?300:base?Math.floor(base*1.16*10)/10:300} step=".1" disabled={!deck.track||(!editingGrid&&!base)} value={draft??(editingGrid?base:deck.effectiveBpm)?.toFixed(1)??''} placeholder="Unknown" onChange={event=>setDraft({revision,value:event.currentTarget.value})}/></label><button type="submit" disabled={!deck.track||(!editingGrid&&!base)}>Apply</button></form>
        <div className="bpm-actions bpm-correction" hidden={!editingGrid}><button type="button" aria-label={'Tap BPM '+id} disabled={!deck.track} onClick={tap}>{tapCount?'Tap '+tapCount+'/4':'Tap 4 beats'}</button><button type="button" aria-label={'Half BPM '+id} disabled={!base||base/2<30} onClick={()=>correctTrackBpm(base!/2)}>Half <small>{base?(base/2).toFixed(1):'—'}</small></button><button type="button" aria-label={'Double BPM '+id} disabled={!base||base*2>300} onClick={()=>correctTrackBpm(base!*2)}>Double <small>{base?(base*2).toFixed(1):'—'}</small></button></div>
        <button className="bpm-detected" type="button" hidden={!editingGrid||canClearManualBpm} disabled={!canRestoreDetected} title="Restore this track's analyzed BPM" onClick={()=>{if(current()&&canRestoreDetected)run(()=>engine.clearBeatGridOverride(id));setDraft(null);}}>Use detected BPM</button>
        <button className="bpm-detected" type="button" hidden={!editingGrid||!canClearManualBpm} title="Remove the manual BPM and return to unknown tempo" onClick={()=>{if(current()&&canClearManualBpm)run(()=>engine.clearBeatGridOverride(id));setDraft(null);}}>Clear manual BPM</button>
        <p className="bpm-analysis-status" role="status">{!editingGrid?'Changes playing speed; track BPM stays the same.':tapCount&&tapCount<4?'Tap with the beat · '+tapCount+' of 4':base?(estimated?deck.bpmAnalysis.tempoRange?'Estimate range · '+deck.bpmAnalysis.tempoRange.minimum.toFixed(1)+'–'+deck.bpmAnalysis.tempoRange.maximum.toFixed(1)+' BPM':'Tempo estimate · check Half or Double if needed':deck.beatGrid?.source==='auto'?'Detected tempo':'Set tempo'):analyzing?'Finding the rhythm…':'Tap four beats or enter the track BPM.'}</p>
      </div>
    </div>
  </details>;
}
