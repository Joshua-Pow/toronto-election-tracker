# Toronto election tracker

A live results page for the 2026 Toronto municipal election. It shows the Mayor race city-wide, a ward map coloured by who is leading, vote share and lead over time, and a ward-by-ward table for Councillor and Mayor.

All numbers come from the City of Toronto's unofficial media results feed:
https://mediaresults.toronto.ca/results/unofficialresult.json
(plus the Mayor by ward feed, `unofficialresult-wardbyward.json`, at the same address).

**These results are unofficial.** The City of Toronto's own results are the source of truth, and nothing here is final until the City Clerk certifies it. The tracker has no projections or "chance of winning"; it only shows what the City has counted so far.

## Run it

You need Node 18 or later.

```bash
npm install
node server.js        # or: npm start
# open http://localhost:8026
```

Environment variables:

- `PORT` (default `8026`): HTTP port.
- `HOST` (default `127.0.0.1`): bind address. Loopback only by default; put it behind a tunnel or host to share it.
- `DATA_DIR` (default `./data`): where the last good feed (`latest.json`) and the snapshot history (`history.jsonl`) are kept, so a restart shows results at once and the over-time charts survive restarts.
- `ACCESS_KEY` (optional, at least 24 characters): turns on a private-link gate. Visitors open `/?key=<key>` once, which sets an HttpOnly cookie and redirects to a clean URL; anything else gets a plain 404. `/healthz` stays open.

## How it works

- The server fetches the City feeds itself (the browser can't, because of CORS), with conditional GETs. The City publishes about once a minute. Once a publication is in hand, the server reads the file one second after the next one. Until the file starts changing, or a check fails, it looks again every 20 seconds, and it never polls faster than that. Viewers only read the server's in-memory copy, so many viewers still mean one City fetch per check. The tracker is read-only towards the City.
- The browser asks `/api/state` about 1.2 seconds after the server's next check, waits at most 20 seconds between asks, and loads immediately when the tab becomes visible. `?demo=live` follows the sample clock, about every 4 seconds.
- Local history starts when the server first runs and is kept in `data/history.jsonl`. If you start it late, the charts start then; no earlier history is invented. The deployed Worker has its own database, described under Deploy.
- Ward boundaries are the City Wards (25-ward model) from Toronto Open Data, simplified with mapshaper (`public/wards.geojson`). Map tiles are Esri World Light Gray.
- Front end: plain JavaScript. Locally the Node server serves `public/` directly. Leaflet for the map, D3 for chart scales and shapes, Motion for the number, bar, chart and list animations (`public/fluid.js`), and Sonner for notifications. Production is the Worker build below.
- Layout: on desktop the map fills at least the screen height with the candidate list beside it; the top 3 candidates stay pinned and the rest scroll. Vote share and lead charts sit side by side underneath. On phones everything stacks in one column.

## Deploy

Production is one Cloudflare Worker, `toronto-tracker`. The page, CSS, map and scripts are static assets. One SQLite Durable Object polls the City on the same schedule as the local server and stores the latest results plus the chart history. Visitors only read `/api/state`. The free plan does not bill past its request allowance; extra `/api/state` calls fail instead of charging. Static files do not spend that allowance.

```bash
npm run deploy
```

That copies `public/` and the vendor libraries into the asset directory, writes `worker/history-seed.json` from `data/history.jsonl`, builds the Worker, and deploys it. On the next request the Durable Object copies in any seeded snapshots it does not already have, so a database that started empty still shows the evening recorded locally. A snapshot the Worker stored itself wins when the timestamps match. After that, new City updates are appended in the Worker database. `data/` is not served as part of the site.

The public address uses the account's `workers.dev` subdomain. Wrangler prints it at the end of the deploy.

## Demo mode

Before results come in, you can preview the page with sample data:

- `/?demo=1` shows a made-up count using the real candidate names and wards. Add `&p=0.5` to pin it at 50% of polls reporting.
- `/?demo=live` simulates live updates: the sample count steps forward every few seconds so you can watch numbers roll, rows reorder and charts move.

Every sample screen has a yellow **SAMPLE DATA** banner, and its tooltips and notifications are labelled too. Live mode never shows synthetic numbers and refuses to render a response marked as sample. Demo mode is built from the zeroed feeds in `fixtures/`.

## Sharing it

`scripts/share-cloudflare.sh` shares the tracker from a Mac through a free Cloudflare quick tunnel:

```bash
brew install cloudflared                 # once
npm install                              # once
scripts/share-cloudflare.sh --new-key    # private link, key saved to .access_key (chmod 600)
scripts/share-cloudflare.sh              # reuse .access_key or $ACCESS_KEY
scripts/share-cloudflare.sh --open       # no key: anyone with the URL can view
```

It starts the server on `127.0.0.1` only, starts the tunnel, prints the public link, keeps the Mac awake while running, and stops everything on Ctrl-C. The link changes every time you start it. Cloudflare terminates HTTPS, so it can see the traffic, including the key on the first request. Anyone you give a private link to can pass it on.

## Security

The server only answers GET and HEAD, serves an explicit allowlist of files (never `data/`, `fixtures/`, dotfiles, server code or `node_modules/`), and sets strict headers: a CSP with no inline scripts or styles, `nosniff`, `X-Frame-Options: DENY`, and same-origin COOP and CORP. Request size, header size and timeouts are capped. Errors shown to visitors never include paths or stack traces. Feed strings are always inserted as text.

`node scripts/security-check.js <port> [key]` checks all of this against a running server over raw sockets.

## Checks

These use `playwright-core` with a local Chrome (set `CHROME_PATH` or `CHROME` if it isn't found). Pass the server URL and run them against a server without `ACCESS_KEY`; `v7-layout.js` and `cand-order-probe.js` also work with the gate on if you set `KEY_FILE=.access_key`.

- `node scripts/v7-layout.js [url]`: desktop and phone layout, the scrolling candidate list, equal chart sizes, no overflow, no console errors.
- `node scripts/cand-order-probe.js [url]`: candidates stay in vote order (ties by name) as `?demo=live` updates, and reorders animate.
- `node scripts/reorder-probe.js [url]`: row reorder motion.
- `node scripts/mobile-audit.js [url]`: overflow, touch targets and input font sizes on phone sizes.
- `node scripts/v6-card-tap.js [url]`: ward card taps on iPhone sizes in WebKit and Chromium.
- `npm run screenshots`: screenshots of live and sample mode into `screenshots/`.

## Rebuilding the notification bundle

`public/vendor/sonner/toaster.js` is Sonner 2.0.8 with React 18.3.1, bundled into one self-hosted file so nothing loads from a CDN:

```bash
cd tools/toaster && npm ci && node build.mjs
cp out/toaster.js ../../public/vendor/sonner/
cp node_modules/sonner/dist/styles.css ../../public/vendor/sonner/sonner.css
```

## License

MIT, see `LICENSE`. Third-party licenses for the bundled and served libraries (Sonner, React, ReactDOM and Scheduler: MIT; Leaflet: BSD 2-Clause; D3: ISC; Motion: MIT) are in `third_party_licenses/`.
