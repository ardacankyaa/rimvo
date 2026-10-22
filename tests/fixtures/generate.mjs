import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

function runText(args) {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`FFmpeg exited with ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function encode(args) {
  const result = spawnSync(ffmpegPath, args, { encoding: null, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = Buffer.from(result.stderr ?? []).toString('utf8')
    throw new Error(`FFmpeg exited with ${result.status}: ${stderr}`)
  }
  return Buffer.from(result.stdout)
}

function repairStreamableContainer(bytes, container, rate, durationSeconds) {
  if (container === 'wav') {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('FFmpeg did not produce a RIFF WAV')
    bytes.writeUInt32LE(bytes.length - 8, 4)
    const dataOffset = bytes.indexOf(Buffer.from('data'))
    if (dataOffset < 0) throw new Error('Generated WAV is missing its data chunk')
    bytes.writeUInt32LE(bytes.length - dataOffset - 8, dataOffset + 4)
  }
  if (container === 'flac') {
    const magicOffset = bytes.indexOf(Buffer.from('fLaC'))
    if (magicOffset < 0) throw new Error('FFmpeg did not produce FLAC')
    const streamInfoStart = magicOffset + 8
    const sampleInfoOffset = streamInfoStart + 10
    const packed = bytes.readBigUInt64BE(sampleInfoOffset)
    const highBits = packed >> 36n
    const totalSamples = BigInt(rate * durationSeconds)
    bytes.writeBigUInt64BE((highBits << 36n) | totalSamples, sampleInfoOffset)
  }
  return bytes
}

const version = runText(['-version']).split(/\r?\n/, 1)[0]
const fixtures = [
  { name: 'm1-tone-440-mono-44100-pcm16.wav', rate: 44100, channels: 1, codec: 'pcm_s16le', container: 'wav' },
  { name: 'm1-tone-440-stereo-48000-pcm16.wav', rate: 48000, channels: 2, codec: 'pcm_s16le', container: 'wav' },
  { name: 'm1-tone-440-mono-48000-pcm24.wav', rate: 48000, channels: 1, codec: 'pcm_s24le', container: 'wav' },
  { name: 'm1-tone-440-mono-48000-float32.wav', rate: 48000, channels: 1, codec: 'pcm_f32le', container: 'wav' },
  { name: 'm1-tone-440-mono-44100-cbr.mp3', rate: 44100, channels: 1, codec: 'libmp3lame', container: 'mp3', mode: 'cbr' },
  { name: 'm1-tone-440-stereo-48000-vbr.mp3', rate: 48000, channels: 2, codec: 'libmp3lame', container: 'mp3', mode: 'vbr' },
  { name: 'm1-tone-440-mono-44100.flac', rate: 44100, channels: 1, codec: 'flac', container: 'flac' },
  { name: 'm1-tone-440-stereo-48000.flac', rate: 48000, channels: 2, codec: 'flac', container: 'flac' },
]

for (const fixture of fixtures) {
  const { rate, channels, codec, container, mode } = fixture
  const input = channels === 1
    ? `sine=frequency=440:sample_rate=${rate}:duration=8`
    : `aevalsrc=0.25*sin(2*PI*440*t)|0.2*sin(2*PI*660*t):s=${rate}:d=8`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', input,
    '-t', '8', '-map_metadata', '-1', '-ar', String(rate), '-ac', String(channels),
    '-c:a', codec,
  ]
  if (mode === 'cbr') args.push('-b:a', '128k')
  if (mode === 'vbr') args.push('-q:a', '3')
  args.push('-f', container, 'pipe:1')
  const bytes = repairStreamableContainer(encode(args), container, rate, 8)
  await writeFile(resolve(fixtureDirectory, fixture.name), bytes)
}

const validWav = await readFile(resolve(fixtureDirectory, fixtures[0].name))
await writeFile(resolve(fixtureDirectory, 'm1-corrupt.wav'), validWav.subarray(0, 128))

const names = [...fixtures.map(({ name }) => name), 'm1-corrupt.wav']
const readme = [
  '# RIMVO audio test fixtures',
  '',
  'Regenerate with `node tests/fixtures/generate.mjs` (requires FFmpeg on PATH, or set FFMPEG_PATH). This also rewrites this README.',
  '',
  'All playable fixtures are deterministic, locally generated synthetic tones: a 440 Hz mono tone or 440/660 Hz stereo tones. No borrowed or copyrighted recordings are included.',
  '',
  `Generator: ${version}`,
  'Fixture source: generated for RIMVO tests; dedicated to the public domain under CC0-1.0.',
  'Corrupt WAV: the first 128 bytes of the generated PCM16 WAV, retaining its original longer RIFF/data lengths so the file is truncated.',
  '',
  'Files:',
  ...names.map((name) => `- ${name}`),
  '',
].join('\n')
await writeFile(resolve(fixtureDirectory, 'README.md'), readme, 'utf8')
process.stdout.write(`Generated ${names.length} fixtures with ${version}\n`)
