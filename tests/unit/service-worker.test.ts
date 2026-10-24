import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { serviceWorker } from '../../vite.config';

type Emitted = { fileName: string; source: string };
type Hook = (this: unknown, options: unknown, bundle: Record<string, unknown>) => void;
/** File name to content. `.js` files are chunks and everything else an asset, as in Rollup's bundle. */
type Files = Record<string, string>;
function bundleOf(files: Files) {
  return Object.fromEntries(Object.entries({ 'index.html': '<html></html>', ...files }).map(([name, content]) => [
    name,
    name.endsWith('.js') ? { type: 'chunk', code: content } : { type: 'asset', source: content },
  ]));
}
function build(bundleFiles: string[] | Files, publicDir?: string): Emitted {
  const files = Array.isArray(bundleFiles) ? Object.fromEntries(bundleFiles.map(name => [name, 'content of ' + name])) : bundleFiles;
  const emitted: Emitted[] = [];
  (serviceWorker(publicDir).generateBundle as Hook).call({ emitFile: (file: Emitted) => emitted.push(file) }, {}, bundleOf(files));
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

  it('runs after the HTML plugins, so the bundle holds the final index.html', () => {
    expect(serviceWorker().enforce).toBe('post');
  });

  it('fails the build instead of hashing an index.html it cannot see', () => {
    const emit = () => (serviceWorker().generateBundle as Hook).call({ emitFile: () => undefined }, {}, { 'assets/index-a.js': { type: 'chunk', code: '' } });
    expect(emit).toThrow('index.html');
  });
});

describe('offline service worker cache version', () => {
  const version = (source: string) => source.match(/const VERSION = "([0-9a-f]+)";/)![1];
  const temporary: string[] = [];
  afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  /** A copy of public/ without the large audio and archives, which a test can change. */
  function publicCopy() {
    const directory = mkdtempSync(join(tmpdir(), 'rimvo-public-'));
    temporary.push(directory);
    cpSync('public', directory, { recursive: true, filter: source => !/\.(?:wav|flac|mp3|gz)$/.test(source) });
    return directory;
  }
  const files: Files = { 'index.html': '<html><meta charset="UTF-8" /></html>', 'assets/index-a.js': 'console.log(1);', 'assets/index-a.css': 'body{}' };

  it('changes when the names of the built files change', () => {
    expect(version(build({ 'assets/index-a.js': 'a' }).source)).not.toBe(version(build({ 'assets/index-b.js': 'a' }).source));
    expect(version(build(files).source)).toBe(version(build(files).source));
  });

  it('changes when only the content of a built chunk or asset changes', () => {
    const base = version(build(files).source);
    expect(version(build({ ...files, 'assets/index-a.js': 'console.log(2);' }).source)).not.toBe(base);
    expect(version(build({ ...files, 'assets/index-a.css': 'body{margin:0}' }).source)).not.toBe(base);
  });

  it('changes when only index.html changes, such as a new Content-Security-Policy', () => {
    const base = version(build(files).source);
    const policy = '<html><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src \'self\'" /></html>';
    expect(version(build({ ...files, 'index.html': policy }).source)).not.toBe(base);
  });

  it('changes when a precached public file changes without changing its name', () => {
    const publicDir = publicCopy();
    const base = version(build(files, publicDir).source);
    expect(version(build(files, publicDir).source)).toBe(base);
    for (const name of ['site.webmanifest', 'demo-tracks/manifest.json', 'demo-tracks/after-hours.svg', 'brand/icon-192.png', 'favicon.ico']) {
      const path = join(publicDir, name);
      const original = readFileSync(path);
      writeFileSync(path, Buffer.concat([original, Buffer.from([0x20])]));
      expect(version(build(files, publicDir).source), name).not.toBe(base);
      writeFileSync(path, original);
      expect(version(build(files, publicDir).source), name).toBe(base);
    }
  });

  it('ignores files that are not precached', () => {
    const publicDir = publicCopy();
    const base = version(build(files, publicDir).source);
    writeFileSync(join(publicDir, 'SOURCE_CODE.md'), 'changed');
    writeFileSync(join(publicDir, 'demo-tracks', 'CREDITS.txt'), 'changed');
    expect(version(build(files, publicDir).source)).toBe(base);
  });

  it('gives Windows and Linux checkouts the same version', () => {
    const publicDir = publicCopy();
    const base = version(build(files, publicDir).source);
    const withEndings = (content: string, ending: string) => content.replace(/\r\n/g, '\n').replace(/\n/g, ending);
    const crlf = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, withEndings(content + '\n', '\r\n')]));
    const lf = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, withEndings(content + '\n', '\n')]));
    expect(version(build(crlf, publicDir).source)).toBe(version(build(lf, publicDir).source));
    for (const name of ['site.webmanifest', 'demo-tracks/manifest.json', 'demo-tracks/after-hours.svg']) {
      const path = join(publicDir, name);
      writeFileSync(path, withEndings(readFileSync(path, 'utf8'), '\r\n'));
    }
    expect(version(build(files, publicDir).source)).toBe(base);
  });
});

type Listener = (event: Record<string, unknown>) => void;
/** Runs the emitted worker against in-memory Cache Storage and a scripted network. */
function runWorker(bundleFiles: string[]) {
  const scope = 'https://example.test/rimvo/';
  const network = new Map<string, string>();
  let online = true;
  const requests: string[] = [];
  const fetch = async (input: string | { url: string }) => {
    const url = typeof input === 'string' ? input : input.url;
    requests.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    const body = network.get(url);
    const response = new Response(body ?? 'missing', { status: body === undefined ? 404 : 200 });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  };
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (key: string | { url: string }) => typeof key === 'string' ? key : key.url;
  const caches = {
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        async addAll(urls: string[]) {
          for (const url of urls) {
            const response = await fetch(url);
            if (!response.ok) throw new TypeError('Precache request failed: ' + url);
            store.set(url, response);
          }
        },
        async put(key: string | { url: string }, response: Response) { store.set(keyOf(key), response); },
        async match(key: string | { url: string }) { return store.get(keyOf(key))?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
  const listeners: Record<string, Listener> = {};
  const self = { registration: { scope }, clients: { claim: async () => undefined }, addEventListener: (type: string, listener: Listener) => { listeners[type] = listener; } };
  const worker = build(bundleFiles);
  for (const path of precacheOf(worker.source)) network.set(new URL(path, scope).href, 'v1 ' + path);
  runInNewContext(worker.source, { self, caches, fetch, URL });
  return {
    network, requests, stores,
    setOnline(value: boolean) { online = value; },
    async install() {
      let done: Promise<unknown> = Promise.resolve();
      listeners.install({ waitUntil: (promise: Promise<unknown>) => { done = promise; } });
      await done;
    },
    /** Resolves to the worker's response, or undefined when the browser handles the request. */
    async get(path: string, mode = 'no-cors'): Promise<string | undefined> {
      let responded: Promise<Response> | undefined;
      listeners.fetch({ request: { url: new URL(path, scope).href, method: 'GET', mode, headers: new Headers() }, respondWith: (response: Promise<Response>) => { responded = response; } });
      const response = await responded;
      await new Promise(resolve => setTimeout(resolve, 0));
      return response?.text();
    },
  };
}

describe('offline service worker behaviour', () => {
  it('serves the index precached with its own files offline, even after a newer deploy was opened', async () => {
    const sw = runWorker(['index.html', 'assets/index-a.js']);
    await sw.install();
    sw.network.set('https://example.test/rimvo/index.html', 'v2 index.html');
    sw.network.set('https://example.test/rimvo/', 'v2 index.html');
    expect(await sw.get('', 'navigate')).toBe('v2 index.html');
    sw.setOnline(false);
    expect(await sw.get('', 'navigate')).toBe('v1 index.html');
    expect(await sw.get('index.html', 'navigate')).toBe('v1 index.html');
    expect(await sw.get('assets/index-a.js')).toBe('v1 assets/index-a.js');
  });

  it('keeps demo tracks and hashed build files for offline use', async () => {
    const sw = runWorker(['index.html', 'assets/index-a.js']);
    await sw.install();
    sw.network.set('https://example.test/rimvo/demo-tracks/after-hours.wav', 'demo audio');
    sw.network.set('https://example.test/rimvo/assets/index-b.js', 'newer chunk');
    expect(await sw.get('demo-tracks/after-hours.wav')).toBe('demo audio');
    expect(await sw.get('assets/index-b.js')).toBe('newer chunk');
    sw.setOnline(false);
    expect(await sw.get('demo-tracks/after-hours.wav')).toBe('demo audio');
    expect(await sw.get('assets/index-b.js?v=1')).toBe('newer chunk');
  });

  it('leaves license texts, source archives and documents to the network', async () => {
    const sw = runWorker(['index.html']);
    await sw.install();
    for (const path of ['THIRD_PARTY_LICENSES.txt', 'licenses/GPL-3.0.txt', 'source/lamejs-1.2.7-source.tar.gz', 'SOURCE_CODE.md', 'demo-tracks/LICENSE.txt']) {
      expect(await sw.get(path), path).toBeUndefined();
    }
    const cached = [...sw.stores.values()].flatMap(store => [...store.keys()]);
    expect(cached.some(url => /licenses|source\/|\.txt$|\.md$/.test(url))).toBe(false);
  });
});
