import { describe, it, expect } from 'vitest';
import { createAudioEngine } from '../../src/audio/public';
import type {AudioSnapshot,AudioEngine,DeckId,TrackInfo} from '../../src/audio/types';
import {createTemporaryFxGesture,permanentFxEnabled,createTransitionGesture} from '../../src/features/dj-console/transition-gesture';

function setup(enabled=false){
  const initial=createAudioEngine().getSnapshot();
  let state:AudioSnapshot={...initial,contextState:'running',decks:{A:{...initial.decks.A,revision:1,track:{revision:1} as TrackInfo,fx:{...initial.decks.A.fx,flanger:{...initial.decks.A.fx.flanger,enabled}}},B:{...initial.decks.B,revision:1,track:{revision:1} as TrackInfo}}};
  const api={getSnapshot:()=>state,setFx:(id:DeckId,setting:Parameters<AudioEngine['setFx']>[1])=>{const {type,...value}=setting;state={...state,decks:{...state.decks,[id]:{...state.decks[id],fx:{...state.decks[id].fx,[type]:value}}}};},setFilter:(id:DeckId,filterValue:number)=>{state={...state,decks:{...state.decks,[id]:{...state.decks[id],filterValue}}};},setCrossfader:(crossfader:number)=>{state={...state,mixer:{...state.mixer,crossfader}};}};
  return{api,replace:(next:AudioSnapshot)=>{state=next;}};
}
describe('temporary FX ownership across UI surfaces',()=>{
  it.each([false,true])('restores durable enable=%s while keeping pad amount',enabled=>{
    const {api}=setup(enabled);const gesture=createTemporaryFxGesture(api,'A','flanger');
    gesture.move({type:'flanger',...api.getSnapshot().decks.A.fx.flanger,enabled:true,amount:.72});
    expect(permanentFxEnabled(api,'A','flanger')).toBe(enabled);
    gesture.finish();gesture.finish();
    expect(api.getSnapshot().decks.A.fx.flanger).toMatchObject({enabled,amount:.72});
  });
  it('does not overwrite another surface changing the parameters',()=>{
    const {api}=setup();const gesture=createTemporaryFxGesture(api,'A','flanger');
    gesture.move({type:'flanger',...api.getSnapshot().decks.A.fx.flanger,enabled:true,amount:.72});
    api.setFx('A',{type:'flanger',...api.getSnapshot().decks.A.fx.flanger,enabled:true,amount:.22});
    gesture.finish();expect(api.getSnapshot().decks.A.fx.flanger).toMatchObject({enabled:true,amount:.22});
  });
  it('does not restore old enable into a replacement revision',()=>{
    const {api,replace}=setup();const gesture=createTemporaryFxGesture(api,'A','flanger');
    gesture.move({type:'flanger',...api.getSnapshot().decks.A.fx.flanger,enabled:true});
    const next=api.getSnapshot();replace({...next,decks:{...next.decks,A:{...next.decks.A,revision:2,track:{revision:2} as TrackInfo}}});
    gesture.finish();expect(api.getSnapshot().decks.A.fx.flanger.enabled).toBe(true);
  });
  it('Canvas restores its full temporary settings without turning the quick Keep on',()=>{
    const {api}=setup();const baseline=api.getSnapshot().decks.A.fx.reverb;const gesture=createTransitionGesture(api,'air')!;
    gesture.move(.8,.9);expect(api.getSnapshot().decks.A.fx.reverb.enabled).toBe(true);
    expect(permanentFxEnabled(api,'A','reverb')).toBe(false);
    gesture.finish();expect(api.getSnapshot().decks.A.fx.reverb).toEqual(baseline);
  });
  it('leaves closed context state untouched',()=>{
    const {api,replace}=setup();const gesture=createTemporaryFxGesture(api,'A','flanger');
    gesture.move({type:'flanger',...api.getSnapshot().decks.A.fx.flanger,enabled:true});
    replace({...api.getSnapshot(),contextState:'closed'});const closed=api.getSnapshot();gesture.finish();expect(api.getSnapshot()).toBe(closed);
  });
});
