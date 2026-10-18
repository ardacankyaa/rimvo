import type { DeckId } from './types';

/** Pre-crossfader taps. Never connects to context.destination or the recording bus. */
export function createHeadphoneMonitor(context: AudioContext, inputs: Record<DeckId, AudioNode>) {
  const destination = context.createMediaStreamDestination();
  const gains = { A: context.createGain(), B: context.createGain() };
  let disposed = false;
  for (const id of ['A', 'B'] as const) {
    gains[id].gain.value = 0;
    inputs[id].connect(gains[id]); gains[id].connect(destination);
  }
  return {
    stream: destination.stream,
    select(id: DeckId, enabled: boolean) {
      if (disposed) throw new Error('Headphone monitoring has stopped.');
      gains[id].gain.value = enabled ? 0.5 : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of ['A', 'B'] as const) { try { inputs[id].disconnect(gains[id]); } catch { /* Graph may already be closed. */ } gains[id].disconnect(); }
      destination.disconnect(); destination.stream.getTracks().forEach(track => track.stop());
    },
  };
}
