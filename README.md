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
- Tracks, analyses, and recordings belong to the current browser session. Download your recording before closing or refreshing the page.
- BPM and key are estimates; use manual adjustments when needed. Browser and device support, memory, and audio hardware affect performance.

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server |
| `npm start` | Starts the development server and opens the browser |
| `npm run build` | Typechecks and compiles production assets into `dist/` |
| `npm run preview` | Serves the production build locally at port 5174 |
| `npm test` | Runs the test suite with Vitest |
| `npm run lint` | Lints source files with ESLint |
| `npm run typecheck`| Validates TypeScript types across the codebase |

The [CI workflow](.github/workflows/ci.yml) installs dependencies from the lockfile, then runs lint, the production build (including TypeScript checks), and the full test suite on pushes to `main` and pull requests. Successful `main` runs automatically publish the site to https://ardacankyaa.github.io/rimvo/. Pull requests only run checks. The audio tests include a long transport simulation and can take several minutes.

The hosted build uses `npm run build -- --base=/rimvo/` so assets, demos, and audio workers resolve under the public site's path. `npm run build` remains available for other static hosts or local previews. The public site stays available when your own computer is off.

## Project Structure

```
├── public/              # Static assets, branding, and bundled demo tracks
├── src/
│   ├── analysis/        # Web Worker BPM, rhythm, and spectral analysis
│   ├── audio/           # Central audio engine, graph, and AudioWorklet processors
│   ├── dsp/             # Pitch pipeline, resamplers, and transport kernel
│   ├── features/        # DJ console UI components and recording controls
│   ├── legal/           # Privacy policy and local preference persistence
│   ├── library/         # Track metadata parser and library management
│   ├── recording/       # Stereo capture, WAV encoding and MP3 export worker
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

RIMVO processes your audio in memory within your browser session and does not upload personal music or recordings. Application files and bundled demos are served from the application's own origin. The application includes no tracking or telemetry. An optional theme preference can be stored locally when enabled in the Cookies panel.

## License

This project is licensed under the [MIT License](LICENSE).  
Bundled demo tracks and artwork are dedicated to the public domain under [CC0 1.0 Universal](public/demo-tracks/LICENSE.txt).
Dependencies and generic interface icons retain their own licenses and attribution. See the [distribution notices](public/THIRD_PARTY_LICENSES.txt), including the MP3 encoder's LGPL-3.0 notice. Dependency names, copyright notices, and compatibility identifiers identify technical components; the application's name and visual identity are RIMVO.
