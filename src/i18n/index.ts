import { useSyncExternalStore } from 'react';
import { english, turkish } from './tr';

export type Language = 'en' | 'tr';
let language: Language = 'en';
try { if (localStorage.getItem('rimvo-language') === 'tr') language = 'tr'; } catch { /* Session-only language remains usable. */ }
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getLanguage = () => language;
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage, getLanguage);
export function setLanguage(next: Language): void {
  language = next;
  try { localStorage.setItem('rimvo-language', next); } catch { /* Storage is optional. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}
/** Translate UI copy, never track names, device names, file names, or user-entered data. */
export function t<T>(value: T): T {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (language === 'en') return (Object.hasOwn(english, text) ? value.replace(text, english[text]) : value) as T;
  const direct = Object.hasOwn(turkish, text) ? turkish[text] : undefined;
  if (direct) return value.replace(text, direct) as T;
  const tapProgress = text.match(/^Tap with the beat · (\d+) of 4$/);
  if (tapProgress) return `Ritme göre vur · ${tapProgress[1]} / 4` as T;
  const estimateRange = text.match(/^Estimate range · (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) BPM$/);
  if (estimateRange) return `Tahmin aralığı · ${estimateRange[1]}–${estimateRange[2]} BPM` as T;
  const gridConfidence = text.match(/^(\d+)% grid confidence$/);
  if (gridConfidence) return `Izgara güveni %${gridConfidence[1]}` as T;
  const tapCount = text.match(/^Tap (\d+)\/4$/);
  if (tapCount) return `Vur ${tapCount[1]}/4` as T;
  const effectFeel = text.match(/^Hold & move · (Repeats|Reverb space|Sweep|Pulse|Grit)$/);
  if (effectFeel) return `Basılı tut ve hareket ettir · ${turkish[effectFeel[1]] ?? effectFeel[1]}` as T;
  const liveEffect = text.match(/^(Echo|Room|Flanger|Tremolo|Drive) · Live$/);
  if (liveEffect) return `${turkish[liveEffect[1]] ?? liveEffect[1]} · Canlı` as T;
  // Only translate the application's wrapper and known diagnostics. The title
  // and unknown browser diagnostics may contain user data and stay verbatim.
  const loadFailure = text.match(/^Could not load (.+) into Deck ([AB])\.(?: (.+))?$/s);
  if (loadFailure) {
    const [, name, id, cause] = loadFailure;
    const subject = name === 'the selected file' ? 'Seçilen dosya' : name === 'the selected track' ? 'Seçilen parça' : `${name},`;
    const detail = cause && Object.hasOwn(turkish, cause) ? turkish[cause] : cause;
    return `${subject} ${id} kanalına yüklenemedi.${detail ? ` ${detail}` : ''}` as T;
  }
  const gridChoice = text.match(/^Use (\d+(?:\.\d+)?) BPM grid ([AB])$/);
  if (gridChoice) return `${gridChoice[2]} için ${gridChoice[1]} BPM ızgarasını kullan` as T;
  const estimate = text.match(/^Use this beat estimate \((\d+)% confidence\)$/);
  if (estimate) return `Bu vuruş tahminini kullan (%${estimate[1]} güven)` as T;
  const adding = text.match(/^Adding (\d+) local tracks?( to Deck ([AB]))?…$/);
  if (adding) return (adding[3] ? `${adding[1]} yerel parça ${adding[3]} kanalına ekleniyor…` : `${adding[1]} yerel parça ekleniyor…`) as T;
  const skipped = text.match(/^(\d+) files? skipped\. (.+)$/s);
  if (skipped) {
    // Only the reason labels are translated; the quoted file names stay verbatim.
    const rest = skipped[2].replace(/(^|”\. )(Not MP3, WAV or FLAC|Empty or larger than 128 MiB|Session limit of 200 tracks reached): /g, (_match, lead: string, label: string) => `${lead}${turkish[label]}: `);
    return `${skipped[1]} dosya atlandı. ${rest}` as T;
  }
  const unloaded = text.match(/^Unloaded Deck ([AB])\.$/); if (unloaded) return `${unloaded[1]} kanalı boşaltıldı.` as T;
  const removed = text.match(/^Removed (.+) from the library\. Loaded audio keeps playing\.$/s);
  if (removed) return `${removed[1]} kütüphaneden kaldırıldı. Yüklü ses çalmaya devam ediyor.` as T;
  const download = text.match(/^Download requested: (.+)$/s);
  if (download) return `İndirme istendi: ${download[1]}` as T;
  const deck = text.match(/^(.*?)(?: ([AB]))$/);
  if (deck && turkish[deck[1]]) return `${turkish[deck[1]]} ${deck[2]}` as T;
  const effect = text.match(/^(Select|Hold|Keep|Enable) (Echo|Room|Flanger|Tremolo|Drive) ([AB])$/);
  if (effect) return `${({Select:'Seç',Hold:'Basılı tut',Keep:'Sabitle',Enable:'Etkinleştir'} as Record<string,string>)[effect[1]]} ${turkish[effect[2]] ?? effect[2]} ${effect[3]}` as T;
  const dynamic = text.match(/^(Load|Reload|Replace) ([AB]): (.+)$/);
  if (dynamic) return `${turkish[dynamic[1]] ?? ({Reload:'Yeniden yükle'} as Record<string,string>)[dynamic[1]]} ${dynamic[2]}: ${dynamic[3]}` as T;
  const step = text.match(/^Step (\d+) of 3$/); if (step) return `Adım ${step[1]} / 3` as T;
  const loaded = text.match(/^Loaded (.+) into Deck ([AB])\.$/); if (loaded) return `${loaded[1]}, ${loaded[2]} kanalına yüklendi.` as T;
  const loading = text.match(/^Loading (.+) into Deck ([AB])…$/); if (loading) return `${loading[1]}, ${loading[2]} kanalına yükleniyor…` as T;
  const beats = text.match(/^(\d+(?:\/\d+)?) beats?$/); if (beats) return `${beats[1]} vuruş` as T;
  const cue = text.match(/^(Hot cue|Clear hot cue) (\d+) ([AB])(.*)$/); if (cue) return `${cue[1] === 'Hot cue' ? 'Hot cue' : 'Hot cue temizle'} ${cue[2]} ${cue[3]}${cue[4].replace(/ Set$/, ' Belirle')}` as T;
  const target = text.match(/^(Load into|Loaded in) ([AB])$/); if (target) return `${target[2]} kanalına ${target[1] === 'Load into' ? 'yükle' : 'yüklendi'}` as T;
  const title = text.match(/^(BPM for|Retry BPM|Remove) (.+)$/); if (title) return `${({ 'BPM for': 'BPM', 'Retry BPM': 'BPM yeniden dene', Remove: 'Kaldır' } as Record<string,string>)[title[1]]}: ${title[2]}` as T;
  return value;
}
