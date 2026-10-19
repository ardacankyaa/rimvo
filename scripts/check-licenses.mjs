import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const normalize = value => value.replace(/\r\n/g, '\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(root, 'public/source/manifest.json'), 'utf8'));
const distribution = join(root, process.argv.includes('--dist') ? 'dist' : 'public');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(manifest.format === 1 && manifest.files.length >= 6, 'Invalid source-distribution manifest.');
for (const item of manifest.files) {
  assert(!item.path.includes('..') && /^(source|licenses)\/[\w.-]+$/.test(item.path), 'Unsafe license material path.');
  const bytes = readFileSync(join(distribution, item.path));
  assert(bytes.length === item.bytes && sha256(bytes) === item.sha256, `Source/license integrity mismatch: ${item.path}`);
}
const mit = normalize(readFileSync(join(root, 'LICENSE'), 'utf8')).trim();
assert(mit.includes('Copyright (c) 2026 Arda Çankaya and RIMVO contributors'), 'Missing project author attribution.');
const notices = normalize(readFileSync(join(distribution, 'THIRD_PARTY_LICENSES.txt'), 'utf8'));
assert(notices.includes(mit), 'Distribution must include the complete project MIT notice.');
assert(notices.includes('Copyright (c) Meta Platforms') && notices.includes('Copyright (c) 2023 Phosphor Icons'), 'Missing third-party MIT attribution.');
for (const component of manifest.components) assert(notices.includes(component.sourceCommit), `Missing pinned source notice: ${component.name}`);
assert(readFileSync(join(distribution, 'SOURCE_CODE.md'), 'utf8').includes(manifest.applicationSource.commit), 'Application source reference is inconsistent.');
assert(readFileSync(join(distribution, 'licenses/LGPL-3.0.txt'), 'utf8').includes('Combined Works.'), 'Missing full LGPL terms.');
assert(readFileSync(join(distribution, 'licenses/GPL-3.0.txt'), 'utf8').includes('Corresponding Source'), 'Missing full GPL terms.');

const runtimeFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path); else if (entry.isFile()) runtimeFiles.push(relative(root, path).replaceAll('\\', '/'));
  }
}
walk(join(root, 'src'));
runtimeFiles.push('index.html', 'vite.config.ts', 'package-lock.json');
const digest = createHash('sha256');
for (const path of runtimeFiles.sort()) digest.update(path + '\0').update(normalize(readFileSync(join(root, path), 'utf8'))).update('\0');
assert(digest.digest('hex') === manifest.applicationSource.runtimeSha256, 'Runtime changed: update SOURCE_CODE.md and the application source commit/digest to the released source.');
console.log(`Verified author/license notices, ${manifest.files.length} source/license files, and pinned runtime sources in ${relative(root, distribution)}.`);
