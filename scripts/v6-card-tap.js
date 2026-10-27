// Card tap -> map + panel in view. WebKit (Safari engine) with iPhone 15 / SE emulation, on ?demo=live while rows update and reorder.
// Usage: node scripts/v6-card-tap.js [base] -> screenshots/v6/*.png, card-tap-checks.json
const { webkit, chromium, devices } = require('playwright-core');
const fs = require('fs');
const base = process.argv[2] || 'http://127.0.0.1:8026';
// WebKit drops the gate's Secure cookie on plain http://127.0.0.1, so run this against an open (no key) test server.
const q = process.env.KEY_FILE ? '&key=' + fs.readFileSync(process.env.KEY_FILE, 'utf8').trim() : '';
const out = __dirname + '/../screenshots/v6/';
fs.mkdirSync(out, { recursive: true });
const DEV = [['iphone15', devices['iPhone 15']], ['iphonese', devices['iPhone SE']]];
const WARDS = ['7', '21', '25'];
(async () => {
  const report = {};
  for (const [engineName, engine] of [['webkit', webkit], ['chromium', chromium]]) {
    const b = await engine.launch(engineName === 'chromium' ? { executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] } : {});
    for (const [dn, dev] of DEV) for (const reduced of [false, true]) {
      if (engineName === 'chromium' && reduced) continue;
      const ctx = await b.newContext({ ...dev, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/style-src/.test(m.text()) && errs.push(m.text())); // WebKit flags its own <select> UA shadow styles; not page code
      await p.goto(`${base}/?demo=live${q}`, { waitUntil: 'networkidle' });
      await p.waitForFunction(() => document.querySelectorAll('#ward-rows tr[data-ward]').length >= 25 && document.querySelector('#map .ward-shape'), null, { timeout: 60000 });
      await p.waitForTimeout(+(process.env.WARM||9000));
      const tag = `${engineName}-${dn}${reduced ? '-reduced' : ''}`;
      const R = (report[tag] = { wards: {}, errors: errs });
      for (const num of WARDS) {
        // scroll the card into view the way a user would, then tap the card body (not the name)
        await p.evaluate((n) => document.querySelector(`#ward-rows tr[data-ward="${n}"]`).scrollIntoView({ block: 'center' }), num);
        await p.waitForTimeout(500);
        const pt = await p.evaluate((n) => { const r = document.querySelector(`#ward-rows tr[data-ward="${n}"]`).getBoundingClientRect(); return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.6 }; }, num);
        const t0 = Date.now();
        await p.touchscreen.tap(pt.x, pt.y);
        // wait for the scroll to settle (stable 400 ms)
        let last = -1, stableSince = Date.now(), firstAt = null;
        while (Date.now() - t0 < 4000) { await p.waitForTimeout(50); const y = await p.evaluate(() => scrollY); if (y !== last) { last = y; stableSince = Date.now(); } else if (Date.now() - stableSince > 400) break; }
        await p.waitForTimeout(250);
        const m = await p.evaluate((n) => {
          const vh = (window.visualViewport && visualViewport.height) || innerHeight;
          const banner = document.querySelector('.sample-banner:not([hidden])');
          const inset = banner && getComputedStyle(banner).position === 'sticky' ? banner.getBoundingClientRect().bottom : 0;
          const map = document.getElementById('map').getBoundingClientRect();
          const body = document.querySelector('#ward-panel .wp-body').getBoundingClientRect();
          const sel = document.querySelectorAll('#map .ward-shape.is-selected');
          const sr = sel[0] && sel[0].getBoundingClientRect();
          const cx = sr && sr.left + sr.width / 2, cy = sr && sr.top + sr.height / 2;
          return { title: document.getElementById('wp-title').textContent, open: document.getElementById('ward-panel').classList.contains('open') && !document.getElementById('ward-panel').hidden,
            selectedPaths: sel.length, inset: Math.round(inset), vh: Math.round(vh),
            panelTop: Math.round(body.top), panelBottom: Math.round(body.bottom), mapTop: Math.round(map.top), mapBottom: Math.round(map.bottom),
            panelFullyVisible: body.top >= inset - 1 && body.bottom <= vh + 1,
            mapFullyVisible: map.top >= inset - 1 && map.bottom <= vh + 1,
            wardCentreVisible: !!sr && cy >= Math.max(inset, map.top) && cy <= map.bottom && cx >= map.left && cx <= map.right };
        }, num);
        m.wantTitle = num; m.titleOk = m.title.startsWith(`Ward ${num} `); m.settleMs = Date.now() - t0;
        R.wards[num] = m;
        if (engineName === 'webkit' && !reduced) await p.screenshot({ path: `${out}${dn}-card-tap-ward${num}.png` });
      }
      // tapping the same card again keeps the panel open (no toggle off) and brings it back into view
      await p.evaluate(() => document.querySelector('#ward-rows tr[data-ward="25"]').scrollIntoView({ block: 'center' }));
      await p.waitForTimeout(400);
      const box = await p.evaluate(() => { const r = document.querySelector('#ward-rows tr[data-ward="25"]').getBoundingClientRect(); return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.6 }; });
      await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(1500);
      R.sameCardAgainStillOpen = await p.evaluate(() => document.getElementById('ward-panel').classList.contains('open') && document.getElementById('wp-title').textContent.startsWith('Ward 25 '));
      R.pass = Object.values(R.wards).every((w) => w.open && w.titleOk && w.selectedPaths === 1 && w.panelFullyVisible && w.wardCentreVisible) && R.sameCardAgainStillOpen && errs.length === 0;
      await ctx.close();
    }
    await b.close();
  }
  fs.writeFileSync(out + 'card-tap-checks.json', JSON.stringify(report, null, 2));
  for (const [k, v] of Object.entries(report)) console.log(k, 'pass', v.pass, 'again', v.sameCardAgainStillOpen, 'errs', v.errors.length, JSON.stringify(Object.fromEntries(Object.entries(v.wards).map(([n, w]) => [n, [w.open, w.titleOk, w.panelFullyVisible, w.mapFullyVisible, w.wardCentreVisible, w.inset, w.mapTop, w.panelBottom, w.vh, w.settleMs]]))));
})();
