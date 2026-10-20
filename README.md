# RIMVO

> **Rhythm meets volume.** A minimalist, local-first browser DJ console for two-track mixing, creative transitions, and stereo recording with WAV and MP3 downloads.

[MIT license](LICENSE)

**[Open RIMVO in your browser](https://ardacankyaa.github.io/rimvo/)** — no installation or local server needed. Choose **Try a mix** to start with the bundled demo tracks, or add your own music.

---

## Overview

**RIMVO** is a client-only browser application that brings a tactile, hardware-inspired DJ experience directly to the web. It processes audio entirely on the client side using the Web Audio API and custom AudioWorklets—no backend, no accounts, and no audio leaves your device.

## Features

- **Dual-Deck Console:** Independent decks supporting local MP3, WAV, and FLAC audio files.
- **Audio Engine & DSP:** Real-time pitch shifting, vinyl scratch simulation, hot cues, beat loops, and beat jump.
- **BPM & Key Analysis:** In-browser Web Worker rhythm and key estimation, with manual tap and tempo adjustment tools.
- **Creative Transitions & FX:** Dedicated transition canvas (Air, Echo, Sweep), 3-band EQ, resonant filters, flanger, tremolo, and overdrive.
- **Stereo Recording:** Real-time capture of the limiter-guarded master output with versioned downloads. Choose lossless WAV or MP3 at 320 kbps; MP3 conversion runs locally in a background worker.
- **Responsive UI:** Dark and light themes, keyboard shortcuts, and multi-touch controls for touch screens.

## Getting Started

### Prerequisites

- **Node.js**: `24+` or `22.13+`
- **npm**: `10+`

### Run locally for development

1. Clone or download the repository:
   ```bash
   git clone https://github.com/ardacankyaa/rimvo.git
   cd rimvo
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   Open **http://localhost:5173** in a modern browser.

> **Windows Users:** You can also run `start.bat` directly to verify your environment, install dependencies, and launch the application.

### Try your first mix

Choose **Try a mix** to load the two bundled demo tracks. Press **Play both**, move the crossfader, and try the effects. Use the recording control to capture the master output, then stop and choose WAV or MP3 to download your mix. Loading tracks does not start playback automatically.

### Current limits

- Each track is limited to 8 minutes, 128 MiB of source data, and 192 MiB of decoded audio.
- Recording stops at the earlier of 15 minutes or 128 MiB of captured PCM data. At 48 kHz this is about 11 minutes 39 seconds.
- **Session → Save session on this device** stores your library files, deck positions, cues, beat grids, loops, effects, mixer settings and stopped take locally (up to 256 MiB). Restore explicitly after reopening; playback stays paused. Browser storage can be cleared, so download important recordings separately. There is one saved session per site/device; saving again replaces it.
- **Headphones** routes selected decks before the crossfader to a separate audio output in browsers supporting speaker selection. Connect an additional output/audio interface and choose a different device from the main speakers. This monitor signal is excluded from recordings. Unsupported browsers show an explanation and keep the main mixer available.
- Choose **EN / TR** for English or Turkish. Your selected language is remembered on this device; library search uses that language's case rules, including Turkish dotted and dotless I.
- Session tools refresh saved-session availability across tabs and read the latest device save before restoring. Unreadable saves show a recovery message and can be deleted explicitly. Opening Session or Headphones closes the other panel; Escape closes it and returns focus to its button.
- Session restore preserves the selected speed/tone mode, stored semitone value and exact loop bounds, including beat loops whose BPM grid was edited after creation.
- Recording shows remaining time and warns during the final minute. Discarding an unsaved take requires confirmation; MP3 conversion shows progress and can be cancelled back to WAV.
- BPM and key are estimates; use manual adjustments when needed. Browser and device support, memory, and audio hardware affect performance.

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server |
| `npm start` | Starts the development server and opens the browser |
| `npm run build` | Typechecks and compiles production assets into `dist/` |
| `npm run preview` | Serves the production build locally at port 5174 |
| `npm test` | Runs the test suite with Vitest |
| `npm run test:e2e` | Runs real-browser workflows in Chromium, WebKit and mobile Chromium |
| `npm run lint` | Lints source files with ESLint |
| `npm run typecheck`| Validates TypeScript types across the codebase |
| `npm run check:licenses` | Verifies author notices, dependency sources and license-file integrity; add `-- --dist` after building |

The [CI workflow](.github/workflows/ci.yml) installs dependencies from the lockfile, then runs lint, the production build (including TypeScript checks), unit/DSP tests and browser workflows on pushes to `main` and pull requests. Successful `main` runs automatically publish the site to https://ardacankyaa.github.io/rimvo/. Pull requests only run checks. The audio tests include a long transport simulation and can take several minutes. Before running browser tests locally, install their runtimes with `npx playwright install chromium webkit` (Linux CI also uses `--with-deps`). Browser tests use isolated disposable contexts and the bundled test audio fixtures.

The hosted build uses `npm run build -- --base=/rimvo/` so assets, demos, and audio workers resolve under the public site's path. `npm run build` remains available for other static hosts or local previews. The public site stays available when your own computer is off.

The Playwright WebKit runtime on Windows does not expose Web Audio. Audio workflows are explicitly skipped only for that runtime; interface/fallback checks still run. Linux CI requires the complete Chromium, WebKit and mobile Chromium suite to pass before publishing. Physical headphone routing additionally depends on your browser and connected outputs.

## Project Structure

```
├── public/              # Static assets, branding, and bundled demo tracks
├── src/
│   ├── analysis/        # Web Worker BPM, rhythm, and spectral analysis
│   ├── audio/           # Central audio engine, graph, and AudioWorklet processors
│   ├── dsp/             # Pitch pipeline, resamplers, and transport kernel
│   ├── features/        # DJ console UI components and recording controls
│   ├── legal/           # Privacy policy and local preference persistence
│   ├── i18n/            # English / Turkish interface copy and language preference
│   ├── library/         # Track metadata parser and library management
│   ├── recording/       # Stereo capture, WAV encoding and MP3 export worker
│   ├── session/         # Validated local session storage and explicit restoration
│   ├── state/           # Engine singleton and immutable UI state snapshots
│   ├── ui/              # Control primitives, knobs, sliders, and design tokens
│   ├── App.tsx          # Main console container
│   ├── main.tsx         # React root entry point
│   └── styles.css       # Design system and themes
├── tests/               # Unit and DSP test suites
├── index.html           # HTML entry point
├── package.json         # Project manifest and scripts
├── tsconfig.json        # TypeScript configuration
└── vite.config.ts       # Vite bundler configuration
```

## Privacy & Security

RIMVO processes your audio on your device and does not upload personal music or recordings. Explicit session saves use IndexedDB (`rimvo-sessions`); delete the save from the Session menu or clear site data. Language uses localStorage (`rimvo-language`); optional theme storage is controlled in the Cookies panel. Application files and bundled demos are served from the application's own origin. The application includes no tracking or telemetry and never requests microphone access. Separate headphone output may request speaker-selection permission.

## License

Project-authored application and test code is licensed under the [MIT License](LICENSE), copyright 2026 Arda Çankaya and RIMVO contributors. Preserve the copyright and MIT permission notice when redistributing copies or substantial portions. The MIT grant is unchanged. See [reuse and indexing guidance](ATTRIBUTION.md) for file-level attribution and exclusions.
Bundled demo tracks and artwork are dedicated to the public domain under [CC0 1.0 Universal](public/demo-tracks/LICENSE.txt).
Dependencies and generic interface icons retain their own licenses and attribution. See the [distribution notices](public/THIRD_PARTY_LICENSES.txt), including the MP3 encoder's LGPL-3.0 notice. Dependency names, copyright notices, and compatibility identifiers identify technical components; the application's name and visual identity are RIMVO.

The public distribution includes full [LGPL-3.0](public/licenses/LGPL-3.0.txt) and [GPL-3.0](public/licenses/GPL-3.0.txt) texts, preferred dependency sources, their original notices, pinned provenance and checksums. [Source and rebuild instructions](public/SOURCE_CODE.md) explain how to rebuild the MP3 encoder and recombine it with the MIT application. The source archives keep their upstream licenses; they are not relicensed as MIT. Run `npm run check:licenses` to verify the distribution materials, or `npm run check:licenses -- --dist` after building.
