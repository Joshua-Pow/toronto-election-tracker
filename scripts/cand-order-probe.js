// Candidate order probe on ?demo=live: rows follow votes (desc, ties by name), reorders animate (FLIP), and
// rows that cross between the pinned top 3 and the scroll list keep their node (no pop).
// Usage: KEY_FILE=.access_key node scripts/cand-order-probe.js [base]
const { chromium } = require('playwright-core');
const fs = require('fs');
const base = process.argv[2] || 'http://127.0.0.1:8026';
const q = process.env.KEY_FILE ? '&key=' + fs.readFileSync(process.env.KEY_FILE, 'utf8').trim() : '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const path of ['/?x=1', '/?demo=live']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`${base}${path}${q}`, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => document.querySelectorAll('#cand-top li').length === 3, null, { timeout: 60000 });
    await p.evaluate(() => {
      window.__probe = { moving: 0, crossings: 0, maxMoving: 0 };
      const ids = new WeakMap(); let n = 0;
      const tag = () => [...document.querySelectorAll('#cand-top li')].map((li) => { if (!ids.has(li)) ids.set(li, ++n); return li.dataset.key; });
      let prevTop = tag();
      new MutationObserver(() => { const t = tag(); if (t.join() !== prevTop.join()) { window.__probe.crossings++; prevTop = t; } }).observe(document.querySelector('#cand-top'), { childList: true });
      setInterval(() => { const k = document.querySelectorAll('.cand.ro-moving').length; if (k) window.__probe.moving++; window.__probe.maxMoving = Math.max(window.__probe.maxMoving, k); }, 50);
    });
    const orderOk = () => p.evaluate(() => {
      const rows = [...document.querySelectorAll('#cand-top li, #cand-list li')];
      const v = rows.map((li) => ({ name: li.dataset.key, votes: +li.querySelector('.n .visually-hidden').textContent.replace(/[^0-9]/g, '') }));
      const bad = v.findIndex((x, i) => i && (v[i - 1].votes < x.votes || (v[i - 1].votes === x.votes && v[i - 1].name.localeCompare(x.name) > 0)));
      return { n: rows.length, bad, first: v.slice(0, 4).map((x) => `${x.name} ${x.votes}`), heading: document.querySelector('#cands-heading').textContent, col: document.querySelector('#cands-count').textContent };
    });
    const samples = [];
    for (let i = 0; i < 6; i++) { await p.waitForTimeout(path.includes('demo') ? 6000 : 1000); await p.waitForFunction(() => !document.querySelector('.cand.ro-moving'), null, { timeout: 5000 }).catch(() => {}); samples.push(await orderOk()); }
    console.log(path, JSON.stringify({ samples: samples.map((s) => ({ bad: s.bad, n: s.n, first: s.first })), heading: samples[0].heading, col: samples[0].col, probe: await p.evaluate(() => window.__probe), errs }));
    await p.close();
  }
  await b.close();
})();
