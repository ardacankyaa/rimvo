import { expect, it, vi } from 'vitest';
import { createHeadphoneMonitor } from '../../src/audio/headphone-monitor';

it('routes selected decks to a separate media stream and disconnects only its own taps', () => {
  const make = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
  const inputs = { A: make(), B: make() };
  const stop = vi.fn();
  const destination = { ...make(), stream: { getTracks: () => [{ stop }] } };
  const gains = [make(), make()];
  const context = { createGain: vi.fn().mockReturnValueOnce(gains[0]).mockReturnValueOnce(gains[1]), createMediaStreamDestination: () => destination };
  const monitor = createHeadphoneMonitor(context as unknown as AudioContext, inputs as unknown as Record<'A' | 'B', AudioNode>);
  expect(gains[0].gain.value).toBe(0); expect(gains[1].gain.value).toBe(0);
  monitor.select('B', true);
  expect(gains[1].gain.value).toBe(0.5); expect(gains[0].gain.value).toBe(0);
  expect(gains[1].connect).toHaveBeenCalledWith(destination);
  monitor.dispose(); monitor.dispose();
  expect(inputs.A.disconnect).toHaveBeenCalledWith(gains[0]);
  expect(stop).toHaveBeenCalledTimes(1);
});
