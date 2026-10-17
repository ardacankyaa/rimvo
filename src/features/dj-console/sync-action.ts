import type {AudioEngine,DeckId} from '../../audio/types';

/** Match detected tempos; only reliable running grids permit a phase-aligned seek. */
export async function syncForMix(engine:AudioEngine,id:DeckId):Promise<unknown>{
  const masterId=id==='A'?'B':'A',snapshot=engine.getSnapshot(),deck=snapshot.decks[id],master=snapshot.decks[masterId];
  if(deck.sync.status==='active')return engine.syncDeck(id,null);
  if(!deck.track||!master.track)throw new Error('Load a track on both decks to match tempos.');
  if(!deck.beatGrid||!master.beatGrid)throw new Error('Find or enter BPM on both tracks before syncing.');
  if(master.sync.status==='active'&&master.sync.masterId===id)throw new Error('Turn off the other deck’s Sync first.');
  const requested=master.effectiveBpm!,base=deck.beatGrid.bpm;
  let adjusted:number|undefined;
  const previous=master.tempoPercent,revision=master.track.revision;
  if(requested<base*.84||requested>base*1.16){
    const low=Math.max(base*.84,master.beatGrid.bpm*.84),high=Math.min(base*1.16,master.beatGrid.bpm*1.16);
    if(low>high)throw new Error('These tempos are too far apart for the ±16% controls. Choose a closer track.');
    const shared=Math.min(high,Math.max(low,Math.sqrt(deck.effectiveBpm!*master.effectiveBpm!)));
    adjusted=Math.min(16,Math.max(-16,(shared/master.beatGrid.bpm-1)*100));
    await engine.setTempo(masterId,adjusted);
  }
  try{
    const current=engine.getSnapshot(),a=current.decks[id],b=current.decks[masterId];
    if(a.track?.revision!==deck.track.revision||b.track?.revision!==revision)throw new Error('A track changed before Sync finished.');
    const reliable=[a.beatGrid,b.beatGrid].every(grid=>grid&&(grid.source!=='auto'||grid.confidence>=.75));
    return await engine.syncDeck(id,masterId,{mode:reliable&&b.status==='playing'?'beat':'tempo'});
  }catch(cause){
    const current=engine.getSnapshot().decks[masterId];
    if(adjusted!==undefined&&current.track?.revision===revision&&current.tempoPercent===adjusted)await engine.setTempo(masterId,previous).catch(()=>undefined);
    throw cause;
  }
}
