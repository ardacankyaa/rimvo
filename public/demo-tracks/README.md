# RIMVO demo music

Two bundled original synthesized tracks let a fresh clone be tried without a music account, remote provider or personal music files. Choose **Try a mix** on the initial console, then **Play both** or Play A / Play B. Loading never starts playback automatically.

| Title | Artist | Duration | BPM | License | Attribution |
| --- | --- | --- | --- | --- | --- |
| After hours | RIMVO originals | 32.54 s | 118 | CC0-1.0 | After hours — RIMVO originals; CC0 1.0 Universal |
| Open circuit | RIMVO originals | 30.97 s | 124 | CC0-1.0 | Open circuit — RIMVO originals; CC0 1.0 Universal |

## Provenance

The bundled compositions and vector covers are documented as project-authored assets. The music uses mathematical oscillator/noise synthesis for percussion, bass and pads, without recordings, voices, borrowed melodies, sound libraries or external samples. No streaming service supplied these files. Each manifest entry links to this local provenance document. The console's **CC0 credits** link opens the plain-text summary in [CREDITS.txt](CREDITS.txt).

This release distributes the finished audio and artwork. The original synthesis generator is not included, so this repository does not provide a command to regenerate these exact assets. Their SHA-256 values, exact duration, encoded size, first beat and finite/peak/RMS measurements are in [manifest.json](manifest.json). Both tracks are stereo 48 kHz PCM16 WAV, together 12,194,032 bytes (~11.63 MiB). Artwork is original SVG.

## Music and artwork license

The project authors dedicated these exact compositions, recordings and artwork to CC0 1.0 Universal in [LICENSE.txt](LICENSE.txt). Including the actual assets in this repository is permitted by that dedication; they can be copied, modified, redistributed and performed, including commercially. Attribution is appreciated but not required by CC0. The per-track attribution strings remain in manifest.json for portfolio credits.

License URL: https://creativecommons.org/publicdomain/zero/1.0/
Legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode
Music and artwork do not inherit the source code MIT license.

## Local operation

Audio files are loaded lazily from this application's own origin. No external provider, media download at startup, upload, API key or streaming account is required. If a demo asset is absent or fails to load, the UI reports the failure and local MP3/WAV/FLAC loading remains available. License/source links are documentation, not runtime dependencies. The user's own music remains their responsibility and is not relicensed by this project.

The compiled UI uses src/library/demo-catalog.json, which must match the public manifest. When changing an asset, update both catalogs and its measured metadata and hashes together. Tests reject catalog/manifest drift. Public assets are served as files, not imported through Vite public URLs.
