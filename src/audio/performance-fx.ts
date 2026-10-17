import type { PerformanceFxSetting } from './types';

export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new RangeError('Drive intensity must be 0–1.');
  const curve = new Float32Array(2049), k = 1 + amount * 19;
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(k * (i / 1024 - 1)) / Math.tanh(k);
  return curve;
}

/** Native, per-deck effects. Oscillators belong to the engine and retire with the FX branch. */
export function createPerformanceFx(context: BaseAudioContext, own: <T extends AudioNode>(node: T) => T) {
  const nodes: AudioNode[] = [], sources: OscillatorNode[] = [];
  let disposed = false;
  const keep = <T extends AudioNode>(node: T): T => { nodes.push(node); return own(node); };
  const gain = () => keep(context.createGain());
  const ramp = (param: AudioParam, value: number) => {
    const now = context.currentTime;
    try { param.cancelAndHoldAtTime(now); } catch { param.cancelScheduledValues(now); }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + .012);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const oscillator of sources) { try { oscillator.stop(); } catch { /* Already stopped or not yet started. */ } }
    for (const node of nodes) { try { node.disconnect(); } catch { /* A closed context may have retired the connection. */ } }
  };
  try {
    const input = gain(), driveDry = gain(), driveWet = gain(), driveSum = gain();
    const shaper = keep(context.createWaveShaper());
    shaper.curve = driveCurve(.3); shaper.oversample = '2x';
    input.connect(driveDry).connect(driveSum);
    input.connect(shaper).connect(driveWet).connect(driveSum);
    driveDry.gain.value = 1; driveWet.gain.value = 0;
    const flangeDry = gain(), flangeWet = gain(), flangeSum = gain();
    const delay = keep(context.createDelay(.02)); delay.delayTime.value = .004;
    const flangeLfo = keep(context.createOscillator()), flangeDepth = gain();
    sources.push(flangeLfo); flangeLfo.frequency.value = .4; flangeDepth.gain.value = .002;
    flangeLfo.connect(flangeDepth).connect(delay.delayTime);
    driveSum.connect(flangeDry).connect(flangeSum);
    driveSum.connect(delay).connect(flangeWet).connect(flangeSum);
    flangeDry.gain.value = 1; flangeWet.gain.value = 0;
    const output = gain(), tremoloLfo = keep(context.createOscillator()), tremoloDepth = gain();
    sources.push(tremoloLfo); tremoloLfo.frequency.value = 3; tremoloDepth.gain.value = 0;
    tremoloLfo.connect(tremoloDepth).connect(output.gain);
    flangeSum.connect(output); output.gain.value = 1;
    for (const source of sources) source.start();
    return {
      input, output, dispose,
      set(setting: PerformanceFxSetting) {
        if (disposed) throw new Error('Performance FX are disposed.');
        if (!['drive','flanger','tremolo'].includes(setting.type)) throw new RangeError('Unsupported performance effect.');
        if (typeof setting.enabled !== 'boolean' || !Number.isFinite(setting.amount) || setting.amount < 0 || setting.amount > 1) throw new RangeError('Invalid effect intensity.');
        if (setting.type !== 'drive' && (!Number.isFinite(setting.rate) || setting.rate < .1 || setting.rate > 8)) throw new RangeError('Effect speed must be0.1–8Hz.');
        const amount = setting.enabled ? setting.amount : 0;
        if (setting.type === 'drive') {
          // Fixed curve avoids swapping a WaveShaper buffer while a gesture is audible.
          ramp(driveDry.gain, 1 - amount * .65); ramp(driveWet.gain, amount * .65);
        } else if (setting.type === 'flanger') {
          ramp(flangeLfo.frequency, setting.rate);
          ramp(flangeDry.gain, 1 - amount * .5); ramp(flangeWet.gain, amount * .5);
        } else {
          ramp(tremoloLfo.frequency, setting.rate);
          ramp(output.gain, 1 - amount * .45); ramp(tremoloDepth.gain, amount * .45);
        }
      },
    };
  } catch (cause) { dispose(); throw cause; }
}
