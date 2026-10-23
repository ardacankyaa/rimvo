# Contributing to RIMVO

Thanks for helping. Bug reports, translations and pull requests are welcome.

## Reporting a bug

Open an issue with your browser and version, operating system, what you did, what you expected and what happened. If a specific audio file triggers the problem, say its format (MP3, WAV or FLAC), length and sample rate. Do not attach music you do not have the right to share.

For security problems, follow [SECURITY.md](SECURITY.md) instead.

## Development setup

Use Node.js 24 (see `.nvmrc`) or 22.13+, then:

```bash
npm ci
npm run dev
```

## Before opening a pull request

Run the same checks as CI. The browser tests need their runtimes, so install them first (once per Playwright version):

```bash
npx playwright install chromium webkit
npm run lint
npm run build -- --base=/rimvo/
npm run check:licenses -- --dist
npm test
npm run test:e2e
```

`npm run test:e2e` runs the workflows in Chromium, WebKit and mobile Chromium against the dev server, plus the `production-offline` project: it builds the hosted `--base=/rimvo/` variant into `dist-e2e/`, serves it with `vite preview`, checks that it runs under its Content-Security-Policy, waits for the service worker and reloads the console offline. For a quicker local run, use `npm run test:e2e -- --project=chromium`, or `npm run test:e2e -- --project=production-offline` after changing `src/pwa/`, `index.html` or `vite.config.ts`. On Windows, WebKit has no Web Audio, so its audio workflows are skipped locally; CI runs them on Linux.

Guidelines:

- Keep processing local. Do not add analytics, tracking, remote services or uploads.
- Every user-facing message needs a Turkish translation in `src/i18n/tr.ts`. `tests/unit/i18n-coverage.test.ts` fails when one is missing.
- Add or update tests for behaviour changes.
- New dependencies need a license compatible with the existing notices. Update `public/THIRD_PARTY_LICENSES.txt` when one is added.

## Releasing

The distribution pins the exact source revision it was built from (`public/SOURCE_CODE.md` and `public/source/manifest.json`). When `src/`, `index.html`, `vite.config.ts` or `package-lock.json` change:

1. Commit the change, but do not push yet.
2. Update the commit and `runtimeSha256` in `public/source/manifest.json` and the commit link in `public/SOURCE_CODE.md` to that commit.
3. Run `npm run check:licenses` (it reports a digest mismatch until step 2 is correct) and commit.
4. Push both commits together. CI checks the pushed tip, so pushing the first commit alone fails its license check.

By contributing, you agree that your contribution is licensed under the project's [MIT license](LICENSE).
