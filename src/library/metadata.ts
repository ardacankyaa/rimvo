export interface LocalMetadata {
    readonly title: string;
    readonly artist: string;
    readonly artwork: Blob | null;
    readonly durationSeconds?: number;
    readonly bpm?: number;
}
const declaredBpm = (value: string): number | undefined => { const n = Number(value.trim()); return Number.isFinite(n) && n >= 30 && n <= 300 ? n : undefined; };
const LIMIT = 1024 * 1024, ART_LIMIT = 512 * 1024;
const clean = (value: string, fallback: string, max = 160) => value.replace(/\p{Cc}/gu, '').trim().slice(0, max) || fallback;
function text(bytes: Uint8Array, encoding = 3): string {
    try {
        const format = encoding === 0 ? 'windows-1252' : encoding === 1 ? 'utf-16le' : encoding === 2 ? 'utf-16be' : 'utf-8';
        return new TextDecoder(format).decode(bytes).replace(/^\uFEFF/, '');
    }
    catch {
        return '';
    }
}
function syncSafe(bytes: Uint8Array, p: number): number {
    if (p + 4 > bytes.length || bytes.slice(p, p + 4).some(n => n > 127))
        return -1;
    return bytes[p] * 2097152 + bytes[p + 1] * 16384 + bytes[p + 2] * 128 + bytes[p + 3];
}
function u32(bytes: Uint8Array, p: number, little = false): number {
    if (p < 0 || p + 4 > bytes.length)
        return -1;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(p, little);
}
function artwork(bytes: Uint8Array, mime: string): Blob | null {
    if (bytes.length < 8 || bytes.length > ART_LIMIT)
        return null;
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const type = png ? 'image/png' : jpg ? 'image/jpeg' : null;
    if (!type || !['image/png', 'image/jpeg', 'image/jpg'].includes(mime.toLowerCase()))
        return null;
    return new Blob([new Uint8Array(bytes)], { type });
}
function pictureId3(data: Uint8Array): Blob | null {
    const encoding = data[0];
    let p = 1;
    while (p < data.length && data[p] !== 0)
        p++;
    const mime = text(data.slice(1, p), 0);
    if (p >= data.length || mime === '-->')
        return null;
    p += 2;
    const stride = encoding === 1 || encoding === 2 ? 2 : 1;
    while (p < data.length) {
        if (data[p] === 0 && (stride === 1 || data[p + 1] === 0)) {
            p += stride;
            break;
        }
        p += stride;
    }
    return artwork(data.slice(p), mime);
}
function pictureFlac(data: Uint8Array): Blob | null {
    let p = 4;
    const mimeSize = u32(data, p);
    p += 4;
    if (mimeSize < 0 || p + mimeSize > data.length)
        return null;
    const mime = text(data.slice(p, p + mimeSize));
    p += mimeSize;
    const descriptionSize = u32(data, p);
    p += 4;
    if (descriptionSize < 0 || p + descriptionSize + 20 > data.length)
        return null;
    p += descriptionSize + 16;
    const size = u32(data, p);
    p += 4;
    if (size < 0 || p + size > data.length)
        return null;
    return artwork(data.slice(p, p + size), mime);
}
function parseComments(data: Uint8Array): Record<string, string> {
    const tags: Record<string, string> = {};
    let p = 0;
    const vendor = u32(data, p, true);
    p += 4;
    if (vendor < 0 || p + vendor + 4 > data.length)
        return tags;
    p += vendor;
    const count = u32(data, p, true);
    p += 4;
    if (count < 0 || count > 1024)
        return tags;
    for (let i = 0; i < count; i++) {
        const length = u32(data, p, true);
        p += 4;
        if (length < 0 || p + length > data.length)
            break;
        const value = text(data.slice(p, p + length));
        p += length;
        const eq = value.indexOf('=');
        if (eq > 0)
            tags[value.slice(0, eq).toUpperCase()] = value.slice(eq + 1);
    }
    return tags;
}
export async function readTrackMetadata(file: File): Promise<LocalMetadata> {
    const fallback = clean(file.name.replace(/\.[^.]+$/, ''), 'Untitled track');
    let title = fallback, artist = 'Local track', image: Blob | null = null, duration: number | undefined, bpm: number | undefined;
    const bytes = new Uint8Array(await file.slice(0, LIMIT).arrayBuffer());
    if (text(bytes.slice(0, 4), 0) === 'RIFF' && text(bytes.slice(8, 12), 0) === 'WAVE') {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let q = 12, rate = 0, alignment = 0;
        while (q + 8 <= bytes.length) {
            const kind = text(bytes.slice(q, q + 4), 0), size = u32(bytes, q + 4, true), body = q + 8;
            if (size < 0 || body + size > file.size)
                break;
            if (kind === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
                rate = v.getUint32(body + 4, true);
                alignment = v.getUint16(body + 12, true);
            }
            if (kind === 'data') {
                if (rate > 0 && alignment > 0 && size % alignment === 0)
                    duration = size / alignment / rate;
                break;
            }
            q = body + size + (size & 1);
        }
    }
    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51 && [3, 4].includes(bytes[3]) && bytes.length >= 10 && (bytes[5] & 0xc0) === 0) {
        const tagSize = syncSafe(bytes, 6);
        if (tagSize >= 0 && tagSize + 10 <= bytes.length) {
            let p = 10;
            const end = tagSize + 10;
            while (p + 10 <= end) {
                const name = text(bytes.slice(p, p + 4), 0);
                if (!/^[A-Z0-9]{4}$/.test(name))
                    break;
                const size = bytes[3] === 4 ? syncSafe(bytes, p + 4) : u32(bytes, p + 4);
                if (size < 0 || p + 10 + size > end)
                    break;
                const flags = bytes[p + 8] | bytes[p + 9];
                const data = bytes.slice(p + 10, p + 10 + size);
                if (flags === 0 && data.length) {
                    if (name === 'TIT2')
                        title = clean(text(data.slice(1), data[0]), fallback);
                    if (name === 'TPE1')
                        artist = clean(text(data.slice(1), data[0]), artist, 120);
                    if (name === 'TBPM')
                        bpm = declaredBpm(text(data.slice(1), data[0]));
                    if (name === 'APIC' && !image)
                        image = pictureId3(data);
                }
                p += 10 + size;
            }
        }
    }
    else if (text(bytes.slice(0, 4), 0) === 'fLaC') {
        let p = 4;
        while (p + 4 <= bytes.length) {
            const header = bytes[p], type = header & 127;
            const size = bytes[p + 1] * 65536 + bytes[p + 2] * 256 + bytes[p + 3];
            p += 4;
            if (p + size > bytes.length)
                break;
            const data = bytes.slice(p, p + size);
            if (type === 0 && data.length === 34) {
                let packed = 0n;
                for (let n = 10; n < 18; n++)
                    packed = (packed << 8n) | BigInt(data[n]);
                const rate = Number(packed >> 44n), samples = Number(packed & ((1n << 36n) - 1n));
                if (rate > 0 && samples > 0)
                    duration = samples / rate;
            }
            if (type === 4) {
                const tags = parseComments(data);
                title = clean(tags.TITLE || '', title);
                artist = clean(tags.ARTIST || '', artist, 120);
                bpm = declaredBpm(tags.BPM || tags.TEMPO || '');
            }
            if (type === 6 && !image)
                image = pictureFlac(data);
            p += size;
            if (header & 128)
                break;
        }
    }
    return Object.freeze({ title, artist, artwork: image, ...(bpm !== undefined ? { bpm } : {}), ...(duration !== undefined && Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}) });
}
