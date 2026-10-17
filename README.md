# RIMVO

> **Rhythm meets volume.** A minimalist, local-first browser DJ console for two-track mixing, creative transitions, and stereo recording with WAV and MP3 downloads.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![React 19](https://img.shields.io/badge/React-19-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)
![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)

---

## Overview

**RIMVO** is a client-only browser application that brings a tactile, hardware-inspired DJ experience directly to the web. It processes audio entirely on the client side using the Web Audio API and custom AudioWorklets—no backend, no accounts, and no audio leaves your device.

## Features

- **Dual-Deck Console:** Independent decks supporting local MP3, WAV, and FLAC audio files.
- **Audio Engine & DSP:** Real-time pitch shifting (via SoundTouch), vinyl scratch simulation, hot cues, beat loops, and beat jump.
- **BPM & Key Analysis:** In-browser Web Worker rhythm and key estimation, with manual tap and tempo adjustment tools.
- **Creative Transitions & FX:** Dedicated transition canvas (Air, Echo, Sweep), 3-band EQ, resonant filters, flanger, tremolo, and overdrive.
- **Stereo Recording:** Real-time capture of the limiter-guarded master output with versioned downloads. Choose lossless WAV or MP3 at 320 kbps; MP3 conversion runs locally in a background worker.
- **Responsive UI:** Dark and light themes, full keyboard navigation, and multi-touch support for touch screens.

## Getting Started

### Prerequisites

- **Node.js**: `24+` or `22.13+`
- **npm**: `10+`

### Installation & Run

1. Clone or download the repository:
   ```bash
   git clone <repo-url>
   cd "Rimvo 1.0.0"
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   Open **http://localhost:5173** in a modern browser (Chrome, Edge, Firefox, or Safari).

> **Windows Users:** You can also run `start.bat` directly to verify your environment, install dependencies, and launch the application.

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

RIMVO is strictly local-first. All audio decoding, analysis, mixing, and recording happen purely in memory within your browser session. No tracking, telemetry, or external network requests are made.

## License

This project is licensed under the [MIT License](LICENSE).  
Bundled demo tracks and artwork are dedicated to the public domain under [CC0 1.0 Universal](public/demo-tracks/LICENSE.txt).
MP3 encoding uses the unmodified [@breezystack/lamejs](https://github.com/shijinyu/lamejs) package (LGPL-3.0), a JavaScript port of [LAME](https://lame.sourceforge.net/). See [third-party notices](public/THIRD-PARTY-NOTICES.txt).
