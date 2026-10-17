export interface CrossfaderGains {
    readonly a: number;
    readonly b: number;
}
export function equalPowerCrossfaderGains(value: number): CrossfaderGains {
    if (!Number.isFinite(value)) {
        throw new RangeError('Crossfader value must be finite.');
    }
    const position = Math.max(0, Math.min(1, value));
    if (position === 0)
        return { a: 1, b: 0 };
    if (position === 1)
        return { a: 0, b: 1 };
    const angle = position * Math.PI / 2;
    return { a: Math.cos(angle), b: Math.sin(angle) };
}
export function dbToGain(db: number): number {
    if (!Number.isFinite(db)) {
        throw new RangeError('Gain in dB must be finite.');
    }
    return 10 ** (Math.max(-160, Math.min(160, db)) / 20);
}
export function clampFinite(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value)) {
        throw new RangeError(label + ' must be finite.');
    }
    return Math.max(minimum, Math.min(maximum, value));
}
export function filterCutoffForValue(value: number, sampleRate: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new RangeError('Filter value and sample rate must be finite and valid.');
    }
    const normalized = Math.max(-1, Math.min(1, value));
    const upper = Math.min(20000, sampleRate * 0.49);
    if (normalized < 0) {
        const mix = -normalized;
        return upper * (80 / upper) ** mix;
    }
    if (normalized > 0) {
        const mix = normalized;
        return 20 * (Math.min(12000, sampleRate * 0.49) / 20) ** mix;
    }
    return upper;
}
/** Mix keeps equal power; cut reaches full level within 8% of either edge. */
export function crossfaderGains(value: number, curve: 'mix' | 'cut'): CrossfaderGains {
    if (curve === 'mix')
        return equalPowerCrossfaderGains(value);
    if (curve !== 'cut' || !Number.isFinite(value))
        throw new RangeError('Crossfader curve and position must be valid.');
    const x = Math.max(0, Math.min(1, value));
    return { a: Math.min(1, (1 - x) / 0.08), b: Math.min(1, x / 0.08) };
}
