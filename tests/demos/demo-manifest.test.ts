import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

type DemoManifestEntry = {
  id: string
  title: string
  artist: string
  source: string
  license: string
  licenseUrl: string
  licenseText: string
  generator: string
  bpm: number
  firstBeatSeconds: number
  beats: number
  durationSeconds: number
  asset: string
  artwork?: string
  encodedBytes: number
  sha256: string
  artworkSha256?: string
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const demosRoot = resolve(projectRoot, 'public/demo-tracks')

function localPath(name: string): string {
  const path = resolve(demosRoot, name)
  const relativePath = relative(demosRoot, path)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..' + sep)) {
    throw new Error('Demo manifest path escapes public/demo-tracks: ' + name)
  }
  return path
}

function verifySha256(path: string, expected: string) {
  const bytes = readFileSync(path)
  expect(expected).toMatch(/^[a-f0-9]{64}$/)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
  return bytes
}

test('ships exactly two local demos with verified rights, bounded size, and matching hashes', () => {
  const manifestPath = resolve(demosRoot, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DemoManifestEntry[]
  expect(manifest).toHaveLength(2)

  const licenseText = readFileSync(localPath(manifest[0].licenseText), 'utf8')
  expect(licenseText).toMatch(/CC0 1\.0 Universal/i)

  let totalBytes = 0
  for (const demo of manifest) {
    expect(demo.id).toMatch(/^[a-z0-9-]+$/)
    expect(demo.title.length).toBeGreaterThan(0)
    expect(demo.artist.length).toBeGreaterThan(0)
    expect(demo.source.length).toBeGreaterThan(0)
    expect(demo.license).toBe('CC0-1.0')
    expect(demo.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/')
    expect(demo.generator).toBe('scripts/generate-demos.mjs')
    expect(demo.bpm).toBeGreaterThanOrEqual(60)
    expect(demo.bpm).toBeLessThanOrEqual(200)
    expect(demo.firstBeatSeconds).toBeGreaterThanOrEqual(0)
    expect(demo.firstBeatSeconds).toBeLessThan(demo.durationSeconds)
    expect(demo.beats).toBeGreaterThan(0)
    expect(demo.durationSeconds).toBeGreaterThan(0)
    expect(demo.durationSeconds).toBeLessThanOrEqual(60)

    const assetPath = localPath(demo.asset)
    const asset = verifySha256(assetPath, demo.sha256)
    expect(statSync(assetPath).size).toBe(demo.encodedBytes)
    totalBytes += asset.byteLength

    if (demo.artwork && demo.artworkSha256) {
      verifySha256(localPath(demo.artwork), demo.artworkSha256)
    }
  }

  expect(totalBytes).toBeLessThanOrEqual(24 * 1024 * 1024)
  expect(licenseText).toMatch(/https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/legalcode/i)
})
