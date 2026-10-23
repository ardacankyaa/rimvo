import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
it('ships two original CC0 stereo demos with verifiable hashes and safe PCM peaks', () => { const root = new URL('../../public/demo-tracks/', import.meta.url); const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
    asset: string;
    artwork: string;
    sha256: string;
    artworkSha256: string;
    license: string;
    bpm: number;
    firstBeatSeconds: number;
    measuredSamplePeak: number;
    encodedBytes: number;
}[]; expect(manifest).toHaveLength(2); let size = 0; for (const d of manifest) {
    const bytes = readFileSync(new URL(d.asset, root));
    size += bytes.length;
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.sha256);
    expect(createHash('sha256').update(readFileSync(new URL(d.artwork, root))).digest('hex')).toBe(d.artworkSha256);
    expect(d.license).toBe('CC0-1.0');
    expect(d.bpm).toBeGreaterThan(100);
    expect(d.firstBeatSeconds).toBe(0);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt16LE(22)).toBe(2);
    expect(bytes.readUInt32LE(24)).toBe(48000);
    expect(bytes.length).toBe(d.encodedBytes);
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2)
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)) / 32768);
    expect(peak).toBe(d.measuredSamplePeak);
    expect(peak).toBeLessThan(.7);
} expect(size).toBeLessThan(24 * 1024 * 1024); expect(readFileSync(new URL('LICENSE.txt', root), 'utf8')).toContain('No external samples'); });

it('records complete local provenance and attribution independently of the source code license', () => {
 const root=new URL('../../public/demo-tracks/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as Array<Record<string,string>>;
 for(const track of manifest){
  for(const field of ['title','artist','source','sourceUrl','license','licenseUrl','attribution'])expect(track[field],field).toEqual(expect.any(String));
  expect(track.artist.trim()).not.toBe('');expect(track.attribution.trim()).not.toBe('');
  const source=new URL(track.sourceUrl,root);expect(source.protocol).toBe('file:');
  expect(readFileSync(source,'utf8')).toContain(track.title);
  expect(track.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
 }
});

it('keeps the compiled demo catalog consistent with the published asset provenance',()=>{
 const publicManifest=JSON.parse(readFileSync(new URL('../../public/demo-tracks/manifest.json',import.meta.url),'utf8'));
 const runtimeCatalog=JSON.parse(readFileSync(new URL('../../src/library/demo-catalog.json',import.meta.url),'utf8'));
 expect(runtimeCatalog).toEqual(publicManifest);
});

it('links the library to readable plain-text credits that carry every attribution', () => {
 const root=new URL('../../public/demo-tracks/',import.meta.url);
 const panel=readFileSync(new URL('../../src/features/dj-console/LibraryPanel.tsx',import.meta.url),'utf8');
 const linked=panel.match(/BASE_URL \+ '(demo-tracks\/[^']+)'/)?.[1];
 expect(linked).toBe('demo-tracks/CREDITS.txt');
 const credits=readFileSync(new URL('CREDITS.txt',root),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as Array<Record<string,string>>;
 for(const track of manifest){for(const field of ['title','artist','attribution','licenseUrl'])expect(credits,field).toContain(track[field]);}
 expect(credits).toContain('CC0 1.0 Universal');
 expect(credits).toContain('https://creativecommons.org/publicdomain/zero/1.0/legalcode');
});
