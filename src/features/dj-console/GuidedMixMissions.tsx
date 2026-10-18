import { t } from '../../i18n';
import { useState } from 'react';
import {syncForMix} from './sync-action';
import type { AudioSnapshot, DeckId } from '../../audio/types';
import { engine } from '../../state/engine';

export function GuidedMixMissions({snapshot,completedTransitions,run,loadDemos,onOpenCanvas,onOpenBpm,onNewRound}: {
  snapshot:AudioSnapshot;completedTransitions:number;run:(action:()=>void|Promise<unknown>)=>void;
  loadDemos:()=>Promise<void>;onOpenCanvas:()=>void;onOpenBpm:(id:DeckId)=>void;onNewRound:()=>void;
}) {
  const [stage,setStage]=useState(0);
  const ready=Boolean(snapshot.decks.A.track&&snapshot.decks.B.track);
  const playing=snapshot.contextState==='running'&&snapshot.decks.A.status==='playing'&&snapshot.decks.B.status==='playing';
  const a=snapshot.decks.A.effectiveBpm,b=snapshot.decks.B.effectiveBpm;
  const matched=ready&&a!==null&&b!==null&&Math.abs(a-b)<.3;
  const missingBpm=(['A','B'] as const).filter(id=>snapshot.decks[id].track&&!snapshot.decks[id].beatGrid);
  const tempos=missingBpm.length===0;
  const goals=[playing,matched,completedTransitions>0];
  const titles=['Start two records','Match the tempo','Draw your transition'];
  const descriptions=['Choose two tracks, then start them together.','Bring B to the tempo of A. This checks tempo, not beat alignment.','Open the canvas. Move across to blend, and up to shape the sound.'];
  return <section className="mix-missions" aria-label={t("Guided mix missions")}>
    <ol className="first-mix-steps">{titles.map((title,index)=><li key={title} className={stage>index?'is-complete':stage===index?'is-current':''}><strong>{t(title)}</strong><span>{t(descriptions[index])}</span></li>)}</ol>
    <div className="mix-missions__actions">
      {stage===0&&<button type="button" onClick={()=>run(async()=>{if(!ready){await loadDemos();return;}await engine.playDecks();})}>{t(!ready?'Fill empty decks with demos':playing?'Playing together':'Play both')}</button>}
      {stage===1&&<button type="button" disabled={!ready||!tempos} title={t(!tempos?'Find BPM on both tracks first':undefined)} onClick={()=>run(()=>syncForMix(engine,'B'))}>{t("Match B to A")}</button>}
      {stage===2&&<button type="button" onClick={onOpenCanvas}>{t("Open canvas")}</button>}
      {stage<3?<button type="button" disabled={!goals[stage]} onClick={()=>setStage(stage+1)}>{t(stage===2?'Finish':'Next')}</button>:<><p className="mix-missions__complete">{t("Your first mix, made by you.")}</p><button type="button" onClick={()=>{onNewRound();setStage(0);}}>{t("Try again")}</button></>}
    </div>
    {stage===1&&missingBpm.length>0&&<div className="mix-missions__bpm-recovery"><p>{t("Find the missing tempo, then return to this step.")}</p>{missingBpm.map(id=><button key={id} type="button" onClick={()=>onOpenBpm(id)}>{t("Find BPM / Tap · Deck")}{t(id)}</button>)}</div>}
    {stage<3&&<p className="mix-missions__progress" role="status">{t(goals[stage]?(stage===1?'Tempos matched · continue when you are ready':'Goal reached · continue when you are ready'):'Step '+(stage+1)+' of 3')}</p>}
  </section>;
}
