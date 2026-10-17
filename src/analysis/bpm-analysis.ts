import type { BpmAnalysisSnapshot, BpmCandidate } from '../audio/types';
import {estimateRhythm} from './rhythm-estimate';
import {fitTempoPeriod} from './tempo-fit';
import {tempoWindow,TEMPO_SAMPLE_RATE,hasRhythmicEnergy} from './analysis-window';
import {spectralTempo} from './spectral-tempo';

const ANALYSIS_SECONDS = 60;
const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_CONFIDENCE = 0.45;

function unavailable(): BpmAnalysisSnapshot {
  return Object.freeze({ status: 'unavailable', confidence: 0, candidates: Object.freeze([]) });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function correlation(envelope: Float64Array, lag: number): number {
  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index + lag < envelope.length; index += 1) {
    const left = envelope[index];
    const right = envelope[index + lag];
    product += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? product / denominator : 0;
}

/** Finds a constant-tempo 4/4 grid from the first minute of mono/stereo PCM. */
function analyzeBpmWindow(channels: readonly Float32Array[], sampleRate: number): BpmAnalysisSnapshot {
  if (
    channels.length < 1 || channels.length > 2
    || channels.some(channel => !(channel instanceof Float32Array))
    || channels.some(channel => channel.length !== channels[0].length)
    || !Number.isFinite(sampleRate) || sampleRate < 8_000
    || channels[0].length < sampleRate * 3
  ) return unavailable();

  const frameLimit = Math.min(channels[0].length, Math.floor(sampleRate * ANALYSIS_SECONDS));
  const hopFrames = Math.max(1, Math.round(sampleRate / 200));
  const hopCount = Math.floor(frameLimit / hopFrames);
  if (hopCount < 240) return unavailable();

  const envelope = new Float64Array(hopCount);
  const left = channels[0];
  const right = channels[1] ?? left;
  for (let hop = 0; hop < hopCount; hop += 1) {
    const start = hop * hopFrames;
    const end = Math.min(frameLimit, start + hopFrames);
    let energy = 0;
    for (let frame = start; frame < end; frame += 1) {
      const l = Number.isFinite(left[frame]) ? left[frame] : 0;
      const r = Number.isFinite(right[frame]) ? right[frame] : 0;
      energy += (l * l + r * r) * 0.5;
    }
    envelope[hop] = Math.sqrt(energy / Math.max(1, end - start));
  }

  const onsets = new Float64Array(hopCount);
  let peakOnset = envelope[0];
  let totalOnset = envelope[0];
  onsets[0] = envelope[0];
  let averageEnergy = 0;
  for (let index = 0; index < hopCount; index += 1) averageEnergy += envelope[index];
  averageEnergy /= hopCount;
  for (let index = 1; index < hopCount; index += 1) {
    const onset = Math.max(0, envelope[index] - envelope[index - 1]);
    onsets[index] = onset;
    peakOnset = Math.max(peakOnset, onset);
    totalOnset += onset;
  }
  const meanOnset = totalOnset / hopCount;
  if (peakOnset <= 1e-6 || peakOnset < Math.max(averageEnergy * 0.12, 0.000_01) || meanOnset <= 1e-8) {
    return unavailable();
  }

  const smoothed = new Float64Array(hopCount);
  smoothed[0] = onsets[0];
  smoothed[hopCount - 1] = onsets[hopCount - 1];
  for (let index = 1; index < hopCount - 1; index += 1) {
    smoothed[index] = (onsets[index - 1] + 2 * onsets[index] + onsets[index + 1]) * 0.25;
  }

  const hopSeconds = hopFrames / sampleRate;
  const minimumLag = Math.max(1, Math.round(60 / (MAX_BPM * hopSeconds)));
  const maximumLag = Math.min(hopCount - 2, Math.round(60 / (MIN_BPM * hopSeconds)));
  const scores = new Float64Array(maximumLag + 2);
  let bestLag = minimumLag;
  let bestScore = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    const score = correlation(smoothed, lag);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const leftScore = scores[Math.max(minimumLag, bestLag - 1)];
  const centerScore = scores[bestLag];
  const rightScore = scores[Math.min(maximumLag, bestLag + 1)];
  const curvature = leftScore - 2 * centerScore + rightScore;
  const offset = Math.abs(curvature) > 1e-9
    ? clamp(0.5 * (leftScore - rightScore) / curvature, -0.5, 0.5)
    : 0;
  let refinedLag = bestLag + offset;
  const strength = peakOnset / Math.max(averageEnergy, 1e-6);
  const strengthConfidence = clamp((strength - 0.12) / 0.8, 0, 1);
  const onsetThreshold = peakOnset * 0.35;
  const minimumSpacing = Math.max(1, Math.round(0.12 / hopSeconds));
  const onsetPeaks: number[] = [];
  for (let index = 0; index < hopCount; index += 1) {
    if (onsets[index] < onsetThreshold) continue;
    const previous = onsets[index - 1] ?? -Infinity;
    const next = onsets[index + 1] ?? -Infinity;
    if (onsets[index] < previous || onsets[index] < next) continue;
    const last = onsetPeaks.at(-1);
    if (last !== undefined && index - last < minimumSpacing) {
      if (onsets[index] > onsets[last]) onsetPeaks[onsetPeaks.length - 1] = index;
      continue;
    }
    onsetPeaks.push(index);
  }
  if (onsetPeaks.length < 5) return unavailable();
  refinedLag=fitTempoPeriod(onsetPeaks,refinedLag,hopSeconds)??refinedLag;
  const bpm=60/(refinedLag*hopSeconds);
  const firstOnset = onsetPeaks[0];
  const periodSeconds = refinedLag * hopSeconds;
  let phaseErrorPower = 0;
  for (const onset of onsetPeaks) {
    const beat = Math.round((onset - firstOnset) / refinedLag);
    const errorSeconds = (onset - firstOnset - beat * refinedLag) * hopSeconds;
    phaseErrorPower += errorSeconds * errorSeconds;
  }
  const phaseErrorRms = Math.sqrt(phaseErrorPower / onsetPeaks.length);
  const phaseConsistency = clamp(1 - phaseErrorRms / Math.min(0.04, periodSeconds * 0.08), 0, 1);
  const segmentCount = 3;
  let worstSegmentTempoError = 0;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const segmentStart = Math.floor(segment * hopCount / segmentCount);
    const segmentEnd = Math.floor((segment + 1) * hopCount / segmentCount);
    let localLag = refinedLag;
    let localScore = 0;
    const lagStart = Math.max(minimumLag, Math.floor(refinedLag * 0.75));
    const lagEnd = Math.min(maximumLag, Math.ceil(refinedLag * 1.25));
    for (let lag = lagStart; lag <= lagEnd; lag += 1) {
      let product = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let index = segmentStart; index + lag < segmentEnd; index += 1) {
        const leftValue = smoothed[index];
        const rightValue = smoothed[index + lag];
        product += leftValue * rightValue;
        leftEnergy += leftValue * leftValue;
        rightEnergy += rightValue * rightValue;
      }
      const denominator = Math.sqrt(leftEnergy * rightEnergy);
      const score = denominator > 0 ? product / denominator : 0;
      if (score > localScore) { localScore = score; localLag = lag; }
    }
    if (localScore < 0.25) {
      worstSegmentTempoError = 1;
      continue;
    }
    worstSegmentTempoError = Math.max(worstSegmentTempoError, Math.abs(localLag / refinedLag - 1));
  }
  const segmentConsistency = clamp(1 - worstSegmentTempoError / 0.08, 0, 1);
  const confidence = clamp(((bestScore - 0.1) / 0.65) * strengthConfidence * phaseConsistency * segmentConsistency, 0, 1);
  if (bpm < MIN_BPM || bpm > MAX_BPM || confidence < MIN_CONFIDENCE) return unavailable();

  const firstBeatSeconds = firstOnset * hopSeconds;
  const candidates: BpmCandidate[] = [{ bpm, confidence, firstBeatSeconds }];
  for (const alternative of [bpm / 2, bpm * 2]) {
    if (alternative >= 30 && alternative <= 400) {
      candidates.push({ bpm: alternative, confidence: confidence * 0.72, firstBeatSeconds });
    }
  }
  return Object.freeze({
    status: 'complete',
    confidence,
    candidates: Object.freeze(candidates.map(candidate => Object.freeze(candidate))),
  });
}

export function analyzeBpm(channels:readonly Float32Array[],sampleRate:number):BpmAnalysisSnapshot {
  const analyze=(samples:readonly Float32Array[])=>{if(!hasRhythmicEnergy(samples,sampleRate))return unavailable();const normalized=tempoWindow(samples,sampleRate),strict=analyzeBpmWindow(normalized,TEMPO_SAMPLE_RATE);if(strict.status==='complete')return strict;const spectral=spectralTempo(normalized,TEMPO_SAMPLE_RATE);return spectral.status==='complete'?spectral:estimateRhythm(normalized,TEMPO_SAMPLE_RATE);};
  if(!Number.isFinite(sampleRate)||sampleRate<8000||channels.length<1||channels.length>2||channels.some(c=>!(c instanceof Float32Array)||c.length!==channels[0].length))return unavailable();
  if(channels[0].length<=sampleRate*ANALYSIS_SECONDS)return analyze(channels);
  // Independent observations across the track prevent an intro or fill owning the result.
  const length=Math.floor(sampleRate*45),remaining=channels[0].length-length;
  const observations=Array.from({length:5},(_,index)=>{const start=Math.floor(remaining*index/4),result=analyze(channels.map(c=>c.subarray(start,start+length)));return {start,result};}).filter(o=>o.result.status==='complete');
  if(observations.length<2)return unavailable();
  const opening=observations[0].result;
  const groups:{bpm:number;votes:Map<number,BpmCandidate>;weight:number}[]=[];
  observations.forEach((observation,index)=>{
    for(const candidate of observation.result.candidates.filter(c=>c.confidence>=observation.result.confidence*.85)){
      const absolute={...candidate,firstBeatSeconds:(candidate.firstBeatSeconds+observation.start/sampleRate)%(60/candidate.bpm)};
      let group=groups.find(g=>Math.abs(candidate.bpm/g.bpm-1)<.012);
      if(!group){group={bpm:candidate.bpm,votes:new Map(),weight:0};groups.push(group);}
      const old=group.votes.get(index);if(!old||candidate.confidence>old.confidence)group.votes.set(index,absolute);
    }
  });
  // Dotted and triplet motifs can dominate bass or percussion without changing the beat unit.
  let anchor=opening.candidates[0]?.bpm;
  if(anchor&&opening.confidence<.75){const octave=opening.candidates.find(c=>c.confidence>=opening.confidence*.85&&((anchor!>160&&Math.abs(c.bpm/anchor!-.5)<.02)||(anchor!<80&&Math.abs(c.bpm/anchor!-2)<.06)));if(octave)anchor=octave.bpm;}
  if(anchor&&opening.confidence<.75){
    for(const group of groups){
      const ratio=anchor/group.bpm,metrical=[1,2,.5,1.5,2/3,4/3,.75].find(r=>Math.abs(ratio/r-1)<.035);
      if(metrical&&metrical!==1){const target=groups.find(g=>Math.abs(g.bpm/(group.bpm*metrical)-1)<.035);if(target&&target!==group)for(const [index,vote]of group.votes){if(vote.confidence>=.75)continue;const adjusted={...vote,bpm:vote.bpm*metrical};const old=target.votes.get(index);if(!old||adjusted.confidence>old.confidence)target.votes.set(index,adjusted);}}
    }
  }
  for(const group of groups){const votes=[...group.votes.values()].sort((a,b)=>a.bpm-b.bpm);group.bpm=votes[Math.floor(votes.length/2)].bpm;group.weight=votes.reduce((sum,v)=>sum+v.confidence,0);}
  const meterPreference=(group:typeof groups[number])=>opening.confidence<.75&&groups.some(other=>other!==group&&other.votes.size>=group.votes.size&&other.weight>=group.weight*.85&&((group.bpm>160&&Math.abs(other.bpm/group.bpm-.5)<.02)||(group.bpm<80&&Math.abs(other.bpm/group.bpm-2)<.06)))?1:0;
  groups.sort((a,b)=>b.votes.size-a.votes.size||meterPreference(a)-meterPreference(b)||(anchor&&opening.confidence<.75?Math.abs(Math.log(a.bpm/anchor))-Math.abs(Math.log(b.bpm/anchor)):0)||b.weight-a.weight);
  const best=groups[0];if(!best||best.votes.size<2||best.votes.size<Math.ceil(observations.length*.6))return unavailable();
  const rival=groups.find(g=>![1,.5,2,...(opening.confidence<.75?[1.5,2/3,4/3,.75]:[])].some(r=>Math.abs(g.bpm/best.bpm/r-1)<.03));
  if(rival&&rival.votes.size>=best.votes.size)return unavailable();
  const votes=[...best.votes.values()],period=60/best.bpm,phase=votes[0].firstBeatSeconds%period;
  const phaseAligned=votes.every(v=>{const error=Math.abs(v.firstBeatSeconds%period-phase);return Math.min(error,period-error)<.025;});
  const reliable=best.votes.size===observations.length&&votes.every(v=>v.confidence>=.75)&&phaseAligned&&votes.every(v=>Math.abs(v.bpm-best.bpm)<.1);
  const confidence=Math.min(reliable?1:.74,votes.reduce((sum,v)=>sum+v.confidence,0)/votes.length);
  const candidates:BpmCandidate[]=[{bpm:best.bpm,confidence,firstBeatSeconds:phase}];
  for(const bpm of [best.bpm/2,best.bpm*2])if(bpm>=30&&bpm<=400)candidates.push({bpm,confidence:confidence*.72,firstBeatSeconds:phase});
  const minimum=Math.min(...votes.map(v=>v.bpm)),maximum=Math.max(...votes.map(v=>v.bpm));
  return Object.freeze({status:'complete',confidence,candidates:Object.freeze(candidates.map(c=>Object.freeze(c))),...(maximum-minimum>.5?{tempoRange:Object.freeze({minimum,maximum,sections:best.votes.size})}:{})});
}
