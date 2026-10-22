import { describe, expect, it } from 'vitest';
import { serviceWorker } from '../../vite.config';

type Emitted = { fileName: string; source: string };
function build(bundleFiles: string[]): Emitted {
  const emitted: Emitted[] = [];
  const plugin = serviceWorker();
  const hook = plugin.generateBundle as (this: unknown, options: unknown, bundle: Record<string, unknown>) => void;
  hook.call({ emitFile: (file: Emitted) => emitted.push(file) }, {}, Object.fromEntries(bundleFiles.map(name => [name, {}])));
  expect(emitted).toHaveLength(1);
  return emitted[0];
}
function precacheOf(source: string): string[] {
  return JSON.parse(source.match(/const PRECACHE = (\[.*?\]);/)![1]) as string[];
}

describe('offline service worker', () => {
  it('runs only for production builds', () => {
    expect(serviceWorker().apply).toBe('build');
  });

  it('precaches the built files and the console shell, not large demo audio', () => {
    const worker = build(['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'assets/mp3.worker-def.js', 'assets/index-abc.js.map']);
    expect(worker.fileName).toBe('sw.js');
    expect(worker.source).not.toContain('__RIMVO_');
    const precache = precacheOf(worker.source);
    expect(precache).toEqual(expect.arrayContaining(['index.html', 'site.webmanifest', 'favicon.ico', 'assets/index-abc.js', 'assets/mp3.worker-def.js', 'brand/icon-192.png', 'demo-tracks/manifest.json']));
    expect(precache).not.toContain('assets/index-abc.js.map');
    expect(precache.some(path => path.endsWith('.wav'))).toBe(false);
    expect(new Set(precache).size).toBe(precache.length);
  });

  it('changes its cache version when the built files change', () => {
    const version = (source: string) => source.match(/const VERSION = "([0-9a-f]+)";/)![1];
    expect(version(build(['assets/index-a.js']).source)).not.toBe(version(build(['assets/index-b.js']).source));
    expect(version(build(['assets/index-a.js']).source)).toBe(version(build(['assets/index-a.js']).source));
  });
});
