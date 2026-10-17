import { describe, expect, it } from 'vitest';
type CurvesModule = {
    equalPowerCrossfaderGains?: (value: number) => {
        a: number;
        b: number;
    };
    crossfaderGains?: (value: number, curve: 'mix' | 'cut') => {
        a: number;
        b: number;
    };
    dbToGain?: (db: number) => number;
};
const curveModules = import.meta.glob('../../src/dsp/curves.ts');
async function loadCurves(): Promise<CurvesModule | null> {
    const load = Object.values(curveModules)[0];
    const module = load ? (await load()) as CurvesModule : null;
    expect(typeof module?.equalPowerCrossfaderGains).toBe('function');
    expect(typeof module?.dbToGain).toBe('function');
    return module;
}
describe('production mixer curves', () => {
    it('routes the equal-power crossfader to exact endpoints and an equal-power center', async () => {
        const curves = await loadCurves();
        if (!curves?.equalPowerCrossfaderGains)
            return;
        expect(curves.equalPowerCrossfaderGains(0)).toEqual({ a: 1, b: 0 });
        expect(curves.equalPowerCrossfaderGains(0.5).a).toBeCloseTo(Math.SQRT1_2, 14);
        expect(curves.equalPowerCrossfaderGains(0.5).b).toBeCloseTo(Math.SQRT1_2, 14);
        expect(curves.equalPowerCrossfaderGains(1)).toEqual({ a: 0, b: 1 });
    });
    it('converts dB gain without producing non-finite output', async () => {
        const curves = await loadCurves();
        if (!curves?.dbToGain)
            return;
        expect(curves.dbToGain(0)).toBe(1);
        expect(curves.dbToGain(6)).toBeCloseTo(1.995262, 5);
        expect(curves.dbToGain(-24)).toBeCloseTo(0.0630957, 6);
    });
});
it('supports exact cut endpoints and a bounded 8% transition region', async () => {
    const curves = await loadCurves();
    expect(curves?.crossfaderGains).toBeTypeOf('function');
    if (!curves?.crossfaderGains)
        return;
    expect(curves.crossfaderGains(0, 'cut')).toEqual({ a: 1, b: 0 });
    expect(curves.crossfaderGains(.5, 'cut')).toEqual({ a: 1, b: 1 });
    expect(curves.crossfaderGains(1, 'cut')).toEqual({ a: 0, b: 1 });
    expect(curves.crossfaderGains(.04, 'cut').b).toBeCloseTo(.5, 14);
    expect(curves.crossfaderGains(.96, 'cut').a).toBeCloseTo(.5, 14);
    for (let i = 0; i <= 100; i++) {
        const gains = curves.crossfaderGains(i / 100, 'cut');
        expect(gains.a).toBeGreaterThanOrEqual(0);
        expect(gains.a).toBeLessThanOrEqual(1);
        expect(gains.b).toBeGreaterThanOrEqual(0);
        expect(gains.b).toBeLessThanOrEqual(1);
    }
    expect(curves.crossfaderGains(.5, 'mix').a).toBeCloseTo(Math.SQRT1_2, 14);
    expect(() => curves.crossfaderGains!(NaN, 'cut')).toThrow();
});
