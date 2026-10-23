import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Small files the console needs on first paint. The demo WAVs and license
// material are cached at runtime once they have been opened.
const precachedPublic = ['index.html', 'site.webmanifest', 'favicon.ico', 'demo-tracks/manifest.json'];
const precachedPublicDirectories: Record<string, RegExp> = { brand: /\.png$/, 'demo-tracks': /\.svg$/ };

/** Emits sw.js with the exact files of this build so the console opens offline. */
export function serviceWorker(publicDir = 'public'): Plugin {
  return {
    name: 'rimvo-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [...precachedPublic];
      for (const [directory, pattern] of Object.entries(precachedPublicDirectories)) {
        files.push(...readdirSync(`${publicDir}/${directory}`).filter(name => pattern.test(name)).map(name => `${directory}/${name}`));
      }
      files.push(...Object.keys(bundle).filter(name => name !== 'index.html' && !name.endsWith('.map')));
      const precache = [...new Set(files)].sort();
      const template = readFileSync(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(precache.join('\n')).update(template).digest('hex').slice(0, 16);
      const source = template
        .replace('self.__RIMVO_PRECACHE__', JSON.stringify(precache))
        .replace('self.__RIMVO_VERSION__', JSON.stringify(version));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Everything the console runs, including its workers and audio worklets, comes
// from its own origin. Artwork and recording previews use local blob: URLs.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "style-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Adds the policy to the built index.html. Vite's dev server needs inline scripts for HMR, so it runs without one. */
export function contentSecurityPolicyMeta(policy = contentSecurityPolicy): Plugin {
  return {
    name: 'rimvo-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Directly after the charset declaration, before any script or stylesheet.
        const charset = /<meta charset="[^"]*"\s*\/?>/i;
        if (!charset.test(html) || policy.includes('"')) throw new Error('Cannot add the Content-Security-Policy to index.html.');
        return html.replace(charset, match => `${match}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), contentSecurityPolicyMeta()],
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    entries: ['index.html'],
    include: ['@soundtouchjs/core', '@soundtouchjs/interpolation-strategy-lanczos', '@breezystack/lamejs'],
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
