import { describe, expect, it } from 'vitest';
const modules = import.meta.glob('../../src/library/metadata.ts');
async function api() {
    const load = Object.values(modules)[0];
    expect(load, 'local metadata reader exists').toBeTypeOf('function');
    return await load() as {
        readTrackMetadata(file: File): Promise<{
            title: string;
            artist: string;
            artwork: Blob | null;
        }>;
    };
}
function frame(name: string, data: number[]) { const size = data.length; return [...Array.from(name, c => c.charCodeAt(0)), 0, 0, 0, size, 0, 0, ...data]; }
function tag(frames: number[]) { const n = frames.length; return new Uint8Array([73, 68, 51, 3, 0, 0, (n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127, ...frames]); }
describe('bounded local track metadata', () => {
    it('uses safe filename fallbacks without cloud lookups', async () => { const { readTrackMetadata } = await api(); expect(await readTrackMetadata(new File(['RIFF'], 'night-walk.wav'))).toEqual({ title: 'night-walk', artist: 'Local track', artwork: null }); });
    it('reads WAV duration from bounded headers before deck decoding', async () => {
        const { readTrackMetadata } = await api() as {
            readTrackMetadata(file: File): Promise<{
                durationSeconds?: number;
            }>;
        };
        const bytes = new Uint8Array(44 + 48000 * 2);
        const v = new DataView(bytes.buffer);
        bytes.set([82, 73, 70, 70]);
        v.setUint32(4, bytes.length - 8, true);
        bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 48000, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        bytes.set([100, 97, 116, 97], 36);
        v.setUint32(40, 48000 * 2, true);
        expect((await readTrackMetadata(new File([bytes], 'one-second.wav'))).durationSeconds).toBe(1);
    });
    it('reads ID3 text and embedded PNG without interpreting title markup', async () => { const { readTrackMetadata } = await api(); const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0]; const bytes = tag([...frame('TIT2', [3, ...Array.from('<b>Night</b>', c => c.charCodeAt(0))]), ...frame('TPE1', [3, 65, 114, 100, 97]), ...frame('APIC', [0, ...Array.from('image/png', c => c.charCodeAt(0)), 0, 3, 0, ...png])]); const m = await readTrackMetadata(new File([bytes], 'tone.mp3')); expect(m.title).toBe('<b>Night</b>'); expect(m.artist).toBe('Arda'); expect(m.artwork?.type).toBe('image/png'); expect(m.artwork?.size).toBe(png.length); });
    it('rejects linked artwork and malformed metadata bounds safely', async () => { const { readTrackMetadata } = await api(); const linked = tag(frame('APIC', [0, 45, 45, 62, 0, 3, 0, ...Array.from('https://example.invalid/private', c => c.charCodeAt(0))])); expect((await readTrackMetadata(new File([linked], 'tone.mp3'))).artwork).toBeNull(); expect((await readTrackMetadata(new File([new Uint8Array([73, 68, 51, 4, 0, 0, 127, 127, 127, 127])], 'broken.mp3'))).title).toBe('broken'); });
    it('keeps malformed and implausible BPM tags unavailable', async () => {
        const { readTrackMetadata } = await api() as {
            readTrackMetadata(file: File): Promise<{
                bpm?: number;
            }>;
        };
        for (const value of ['NaN', '0', '-120', '9999', '120junk']) {
            const bytes = tag(frame('TBPM', [3, ...Array.from(value, c => c.charCodeAt(0))]));
            expect((await readTrackMetadata(new File([bytes], 'bad-bpm.mp3'))).bpm).toBeUndefined();
        }
    });
    it('reads declared BPM tags without marking them as a reliable audio grid', async () => { const { readTrackMetadata } = await api() as {
        readTrackMetadata(file: File): Promise<{
            bpm?: number;
        }>;
    }; const bytes = tag(frame('TBPM', [3, 49, 50, 56])); expect((await readTrackMetadata(new File([bytes], 'tagged.mp3'))).bpm).toBe(128); });
});
