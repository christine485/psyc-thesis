# Browser verification

Requires Node 24. Install this separate QA package with `npm ci --prefix qa` and
install the official browser runtimes with
`npx --prefix qa playwright-core install --with-deps chromium firefox webkit`.
This package is separate from the Cloudflare build and does not deploy anything.

Run `npm --prefix qa test`. Select engines with `-- --engines=chromium,firefox,webkit`
or viewport cases with `-- --devices=desktop,phone,small-phone,tablet`.
Use `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` for a system Chromium, or
`PLAYWRIGHT_BROWSERS_PATH` for downloaded runtimes. `PLAYWRIGHT_MODULE_PATH` can
point to an already installed Playwright Core `index.mjs` without another install.

The harness serves the real frontend and Worker handler on localhost with two
isolated in-memory SQLite databases. It enters and submits all 28 trials, loses
the first submission response deliberately, then checks that retry leaves one
saved questionnaire. It does not contact production or submit telephone numbers.
It checks image dimensions and checksums, naming/rating, pause/resume, resizing,
layout at four viewport sizes, image request counts and display latency. A small
artificial image delay exercises preloading. A separate bounded gallery decodes
all 270 original PNGs in each engine. Reports and screenshots go under ignored
`work/browser-qa/` and contain no participant tokens or draw permits.

These are automated Linux browser-engine and viewport tests, not a substitute
for real-device Safari/Chrome and Hong Kong Wi-Fi/mobile-network acceptance.

Run `node qa/researcher-flow.mjs --engine=chromium` (or `firefox`, `webkit`)
to check the researcher page against isolated local data. This verifies denied
unauthenticated access, exact CSV bytes and modes, separate phone exports,
cancelled downloads on logout, credential cleanup, and the blocked GitHub Pages
copy of the sign-in form. It uses the same local Playwright overrides above and
never reads production answers or credentials.
