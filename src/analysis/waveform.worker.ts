import { analyzeWaveform } from './waveform';
import { analyzeBpm } from './bpm-analysis';
import { analyzeKey } from './key-analysis';
import type { WaveformData } from '../audio/types';

type AnalyzeRequest = { readonly id: number; readonly sampleRate: number; readonly channels: ArrayBuffer[] };
type AnalyzeResponse = { readonly id: number; readonly channels: ArrayBuffer[]; readonly waveform: WaveformData; readonly bpmAnalysis: ReturnType<typeof analyzeBpm>; readonly keyAnalysis:ReturnType<typeof analyzeKey> };
type ErrorResponse = { readonly id: number; readonly error: string };

self.addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  const { id, sampleRate, channels: buffers } = event.data;
  try {
    const channels = buffers.map(buffer => new Float32Array(buffer));
    const waveform = analyzeWaveform(channels, sampleRate);
    const bpmAnalysis = analyzeBpm(channels, sampleRate);
    const keyAnalysis=analyzeKey(channels,sampleRate);
    const response: AnalyzeResponse = { id, channels: buffers, waveform, bpmAnalysis,keyAnalysis };
    self.postMessage(response, { transfer: buffers });
  } catch (cause) {
    const response: ErrorResponse = {
      id,
      error: cause instanceof Error ? cause.message : 'Waveform analysis failed.',
    };
    self.postMessage(response);
  }
});
