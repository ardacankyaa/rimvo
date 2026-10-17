import {describe,expect,it,vi} from 'vitest';
import type {AudioEngine,AudioSnapshot} from '../../src/audio/types';
import {syncForMix} from '../../src/features/dj-console/sync-action';
function fixture(a=99.8,b=124){
  const snapshot={decks:{A:{track:{revision:1},beatGrid:{bpm:a,confidence:.6,source:'auto'},tempoPercent:0,effectiveBpm:a,status:'paused',sync:{status:'off',masterId:null}},B:{track:{revision:2},beatGrid:{bpm:b,confidence:1,source:'manual'},tempoPercent:0,effectiveBpm:b,status:'paused',sync:{status:'off',masterId:null}}}} as unknown as AudioSnapshot;
  const setTempo=vi.fn(async(id:'A'|'B',value:number)=>{const deck=snapshot.decks[id] as unknown as {tempoPercent:number;effectiveBpm:number};deck.tempoPercent=value;deck.effectiveBpm=(id==='A'?a:b)*(1+value/100);return {} as never;});
  const syncDeck=vi.fn(async()=>({} as never));const engine={getSnapshot:()=>snapshot,setTempo,syncDeck} as unknown as AudioEngine;return {snapshot,setTempo,syncDeck,engine};
}
describe('consumer Sync action',()=>{
  it('brings 99.8 and 124 BPM into their shared ±16% range and requests tempo-only sync',async()=>{const f=fixture();await syncForMix(f.engine,'A');expect(f.setTempo).toHaveBeenCalledOnce();const target=f.snapshot.decks.B.effectiveBpm!;expect(target).toBeGreaterThanOrEqual(124*.84);expect(target).toBeLessThanOrEqual(99.8*1.16);expect(f.syncDeck).toHaveBeenCalledWith('A','B',{mode:'tempo'});});
  it('leaves the master unchanged when the slave already reaches its tempo',async()=>{const f=fixture(120,124);await syncForMix(f.engine,'A');expect(f.setTempo).not.toHaveBeenCalled();expect(f.syncDeck).toHaveBeenCalledWith('A','B',{mode:'tempo'});});
  it('restores an untouched master adjustment when sync fails',async()=>{const f=fixture();f.syncDeck.mockRejectedValueOnce(new Error('failed'));await expect(syncForMix(f.engine,'A')).rejects.toThrow('failed');expect(f.setTempo).toHaveBeenLastCalledWith('B',0);});
  it('refuses disjoint tempo ranges instead of exceeding the controls',async()=>{const f=fixture(60,180);await expect(syncForMix(f.engine,'A')).rejects.toThrow('too far apart');expect(f.setTempo).not.toHaveBeenCalled();expect(f.syncDeck).not.toHaveBeenCalled();});
});
