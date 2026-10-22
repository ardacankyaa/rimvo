# RIMVO audio test fixtures

Regenerate with `node tests/fixtures/generate.mjs` (requires FFmpeg on PATH, or set FFMPEG_PATH). This also rewrites this README.

All playable fixtures are deterministic, locally generated synthetic tones: a 440 Hz mono tone or 440/660 Hz stereo tones. No borrowed or copyrighted recordings are included.

Generator: ffmpeg version N-92722-gf22fcd4483 Copyright (c) 2000-2018 the FFmpeg developers
Fixture source: generated for RIMVO tests; dedicated to the public domain under CC0-1.0.
Corrupt WAV: the first 128 bytes of the generated PCM16 WAV, retaining its original longer RIFF/data lengths so the file is truncated.

Files:
- m1-tone-440-mono-44100-pcm16.wav
- m1-tone-440-stereo-48000-pcm16.wav
- m1-tone-440-mono-48000-pcm24.wav
- m1-tone-440-mono-48000-float32.wav
- m1-tone-440-mono-44100-cbr.mp3
- m1-tone-440-stereo-48000-vbr.mp3
- m1-tone-440-mono-44100.flac
- m1-tone-440-stereo-48000.flac
- m1-corrupt.wav
