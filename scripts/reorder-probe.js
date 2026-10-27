// Samples every ward row's on-screen top each frame while ?demo=live reorders (sorted "Closest race first").
// Reports how long moves last, the biggest one-frame step, and any overshoot (a row passing its target and coming back).
// Usage: node scripts/reorder-probe.js [base] [seconds] [videoDir]
const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const base = process.argv[2] || 'http://127.0.0.1:8026', secs = Number(process.argv[3] || 20), videoDir = process.argv[4];
const key = fs.readFileSync(__dirname + '/../.access_key', 'utf8').trim();
(async () => {
  // The simulated night replays every 3 min on the wall clock; start just after a replay begins so rows reorder.
  const wait = 180000 - (Date.now() % 180000) + 500;
  if (process.env.NO_WAIT !== '1') { console.error(`waiting ${Math.round(wait / 1000)} s for the demo replay to start`); await new Promise((r) => setTimeout(r, wait)); }
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ ...devices['iPhone 15'], ...(videoDir ? { recordVideo: { dir: videoDir, size: devices['iPhone 15'].viewport } } : {}) });
  const p = await ctx.newPage();
  await p.goto(`${base}/?demo=live&key=${key}`, { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: '.sample-banner{position:static!important}' });
  await p.selectOption('#sort', 'margin');
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const t = document.querySelector('#ward-rows'); scrollTo(0, t.getBoundingClientRect().top + scrollY - 120); });
  await p.waitForTimeout(800);
  const res = await p.evaluate((secs) => new Promise((done) => {
    const tracks = new Map(); const t0 = performance.now(); let frames = 0;
    (function tick() {
      frames++;
      const now = performance.now() - t0;
      for (const tr of document.querySelectorAll('#ward-rows tr')) {
        const vt = tr.getBoundingClientRect().top, y = vt + scrollY;
        const k = tr.dataset.ward; if (!tracks.has(k)) tracks.set(k, []);
        tracks.get(k).push([now, y, vt > -60 && vt < innerHeight]);
      }
      if (now < secs * 1000) requestAnimationFrame(tick); else done({ frames, order: [...document.querySelectorAll('#ward-rows tr')].slice(0, 8).map((t) => t.dataset.ward).join(','), tracks: [...tracks] });
    })();
  }), secs);
  // Analyse: a "move" is a run of frames where a row's y changes.
  let moves = [], maxStep = 0, maxVisStep = 0, overshoots = 0, rev = [];
  for (const [k, pts] of res.tracks) {
    let start = null, startY = null, dir = 0, reversed = false;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i][1] - pts[i - 1][1];
      if (Math.abs(d) > 0.05) {
        if (start == null) { start = pts[i - 1][0]; startY = pts[i - 1][1]; dir = Math.sign(d); reversed = false; }
        else if (Math.sign(d) !== dir && Math.abs(d) > 0.3) { if (!reversed) rev.push({ ward: k, t: Math.round(pts[i][0]), d: +d.toFixed(1) }); reversed = true; }
        maxStep = Math.max(maxStep, Math.abs(d));
        if (pts[i][2] || pts[i - 1][2]) maxVisStep = Math.max(maxVisStep, Math.abs(d));
      } else if (start != null) {
        moves.push({ ms: Math.round(pts[i - 1][0] - start), dist: Math.round(Math.abs(pts[i - 1][1] - startY)) });
        if (reversed) overshoots++;
        start = null;
      }
    }
  }
  const ms = moves.map((m) => m.ms).sort((a, z) => a - z);
  console.log(JSON.stringify({ base, order: res.order, distinctY: res.tracks.slice(0,3).map(([k,p]) => k + ':' + new Set(p.map((x) => Math.round(x[1]))).size), frames: res.frames, rowMoves: moves.length, medianMoveMs: ms[ms.length >> 1] || 0, maxMoveMs: ms.at(-1) || 0,
    maxOneFramePx: Math.round(maxStep), maxVisibleOneFramePx: Math.round(maxVisStep), avgDistPx: moves.length ? Math.round(moves.reduce((s, m) => s + m.dist, 0) / moves.length) : 0, overshootMoves: overshoots, reversals: rev.slice(0, 6) }));
  await ctx.close(); await b.close();
})();
