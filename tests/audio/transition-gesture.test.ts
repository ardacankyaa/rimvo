import { describe, expect, it } from 'vitest';
import { createAudioEngine } from '../../src/audio/public';
import type { AudioSnapshot, DeckId, TrackInfo, AudioEngine } from '../../src/audio/types';
import { createTransitionGesture, transitionChanges, type TransitionScene } from '../../src/features/dj-console/transition-gesture';

function fixture() {
  const initial=createAudioEngine().getSnapshot();
  let snapshot:AudioSnapshot={...initial,contextState:'running',decks:{A:{...initial.decks.A,revision:1,track:{revision:1} as TrackInfo},B:{...initial.decks.B,revision:1,track:{revision:1} as TrackInfo}}};
  const api={getSnapshot:()=>snapshot,setCrossfader:(crossfader:number)=>{snapshot={...snapshot,mixer:{...snapshot.mixer,crossfader}};},
    setFilter:(id:DeckId,filterValue:number)=>{snapshot={...snapshot,decks:{...snapshot.decks,[id]:{...snapshot.decks[id],filterValue}}};},
    setFx:(id:DeckId,setting:Parameters<AudioEngine['setFx']>[1])=>{const {type,...value}=setting;snapshot={...snapshot,decks:{...snapshot.decks,[id]:{...snapshot.decks[id],fx:{...snapshot.decks[id].fx,[type]:value}}}};}};
  return {api,replace:(value:AudioSnapshot)=>{snapshot=value;}};
}
describe('transition parameter ownership',()=>{
  it.each(['air','echo','sweep'] as const)('%s shapes real parameters, restores temporary FX and keeps the committed blend',(scene:TransitionScene)=>{
    const {api}=fixture(),original=api.getSnapshot(),gesture=createTransitionGesture(api,scene)!;
    expect(gesture.move(.85,.9)).toBe(true);
    expect(api.getSnapshot().decks.A.filterValue).toBeGreaterThan(0);
    expect(api.getSnapshot().mixer.crossfader).toBe(.85);
    gesture.finish();gesture.finish();
    expect(api.getSnapshot().decks).toEqual(original.decks);
    expect(api.getSnapshot().mixer.crossfader).toBe(.85);
  });
  it('cancel restores the previous blend, while unrelated edits keep ownership',()=>{
    const {api}=fixture(),original=api.getSnapshot(),gesture=createTransitionGesture(api,'echo')!;
    gesture.move(.8,.7);api.setFilter('A',-.4);gesture.finish(true);
    expect(api.getSnapshot().mixer.crossfader).toBe(original.mixer.crossfader);
    expect(api.getSnapshot().decks.A.filterValue).toBe(-.4);
    expect(api.getSnapshot().decks.B).toEqual(original.decks.B);
    expect(gesture.move(.5,.5)).toBe(false);
  });
  it('does not write old settings into a replacement or a closed context',()=>{
    const {api,replace}=fixture(),gesture=createTransitionGesture(api,'sweep')!;
    gesture.move(.9,.8);const current=api.getSnapshot();
    replace({...current,decks:{...current.decks,A:{...current.decks.A,revision:2,filterValue:-.6}}});
    expect(gesture.move(.5,.9)).toBe(false);expect(api.getSnapshot().decks.A.filterValue).toBe(-.6);
    const next=createTransitionGesture(api,'air')!;next.move(.2,.8);
    replace({...api.getSnapshot(),contextState:'closed'});const closed=api.getSnapshot();next.finish(true);
    expect(api.getSnapshot()).toBe(closed);expect(createTransitionGesture(api,'air')).toBeNull();
  });
  it('preserves a separately changed crossfader and clamps scene amounts',()=>{
    const {api}=fixture(),gesture=createTransitionGesture(api,'air')!;
    gesture.move(.8,.7);api.setCrossfader(.1);gesture.finish(true);expect(api.getSnapshot().mixer.crossfader).toBe(.1);
    const changes=transitionChanges(api.getSnapshot(),'echo',99,99);
    expect(changes.x).toBe(1);expect(changes.decks[0].fx).toMatchObject({wet:.3});
  });
});
