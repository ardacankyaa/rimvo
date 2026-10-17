# RIMVO demo music

Two bundled original synthesized tracks let a fresh clone be tried without a music account, remote provider or personal music files. At the top of the console, choose **Load demo decks**, then Play A / Play B. Loading never starts playback automatically.

| Title | Artist | Duration | BPM | License | Attribution |
| --- | --- | --- | --- | --- | --- |
| After hours | RIMVO originals | 32.54 s | 118 | CC0-1.0 | After hours — RIMVO originals; CC0 1.0 Universal |
| Open circuit | RIMVO originals | 30.97 s | 124 | CC0-1.0 | Open circuit — RIMVO originals; CC0 1.0 Universal |

## Provenance

These compositions and vector covers are project-authored mathematical synthesis, created locally by scripts/generate-demos.mjs in the repository root. Deterministic oscillator/noise synthesis generates percussion, bass and pads; no recordings, voices, borrowed melodies, sound libraries or external samples are used. No streaming service supplied these files. The source URL in each manifest entry is this local provenance document, relative to manifest.json; no remote repository URL is invented.

The already bundled files were moved from public/demos/ without changing their audio/artwork bytes. Their SHA-256 values, exact duration, encoded size, first beat and finite/peak/RMS measurements are in [manifest.json](manifest.json). Both are stereo48kHz PCM16 WAV, together12,194,032bytes (~11.63MiB). Artwork is original SVG. Regenerate from the project root with node scripts/generate-demos.mjs; the generator code is MIT, its generated music/artwork is CC0.

## Music and artwork license

The project authors dedicated these exact compositions, recordings and artwork to CC0 1.0 Universal in [LICENSE.txt](LICENSE.txt). Including the actual assets in this repository is permitted by that dedication; they can be copied, modified, redistributed and performed, including commercially. Attribution is appreciated but not required by CC0. The per-track attribution strings remain in manifest.json for portfolio credits.

License URL: https://creativecommons.org/publicdomain/zero/1.0/
Legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode.en
Verified against the official Creative Commons deed/legal code on3October2026. No uncertain third-party music is included. Music and artwork do not inherit the source code MIT license.

## Local operation

Audio files are loaded lazily from this application's own origin. No external provider, media download at startup, upload, API key or streaming account is required. If a demo asset is absent or fails to load, the UI reports the failure and local MP3/WAV/FLAC loading remains available. License/source links are documentation, not runtime dependencies. The user's own music remains their responsibility and is not relicensed by this project.

The generator also writes src/library/demo-catalog.json for the compiled UI; the public manifest is its matching provenance copy. Tests reject catalog/manifest drift. Public assets are served as files, not imported through Vite public URLs.
