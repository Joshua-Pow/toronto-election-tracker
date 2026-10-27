// v7 layout checks: map card >= screen under the banner, candidates card matches it, its list scrolls inside,
// both chart cards equal, no overflow, no console errors. Usage: KEY_FILE=.access_key node scripts/v7-layout.js [base]
const { chromium } = require('playwright-core');
const fs = require('fs');
const base = process.argv[2] || 'http://127.0.0.1:8026';
const q = process.env.KEY_FILE ? '&key=' + fs.readFileSync(process.env.KEY_FILE, 'utf8').trim() : '';
const out = __dirname + '/../screenshots/v7/';
fs.mkdirSync(out, { recursive: true });
const VP = [[1440, 900], [1280, 800], [1024, 768], [390, 844]];
const MODES = [['live', '/?x=1'], ['demo', '/?demo=live']];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const report = {};
  for (const [w, hgt] of VP) for (const [mode, path] of MODES) {
    const mobile = w < 500;
    const ctx = await b.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`${base}${path}${q}`, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => document.querySelector('#map .ward-shape') && document.querySelectorAll('#cand-top li').length >= 3, null, { timeout: 60000 });
    await p.waitForTimeout(mode === 'demo' ? 8000 : 2500);
    const measure = () => p.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height) }; };
      const banner = document.querySelector('#sample-banner'), box = document.querySelector('#cand-scroll'), ol = document.querySelector('#cand-list');
      const charts = [...document.querySelectorAll('.chart-card')].map((c) => ({ card: Math.round(c.getBoundingClientRect().height), plotTop: Math.round(c.querySelector('.chart').getBoundingClientRect().top + scrollY) }));
      return { vh: innerHeight, banner: banner.hidden ? 0 : Math.round(banner.offsetHeight), gutter: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')),
        mapCard: r('.map-card'), cand: r('.cand-card'), scroll: { h: box.clientHeight, sh: box.scrollHeight, top: box.scrollTop, fade: box.classList.contains('more-below'), bottom: r('#cand-scroll').bottom },
        rows: document.querySelectorAll('#cand-top li').length + ol.children.length, start: ol.start, button: !!document.querySelector('#cand-more'),
        charts, docH: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    const tag = `${w}x${hgt}-${mode}`;
    const m0 = await measure();
    await p.evaluate(() => { const c = document.querySelector('.map-card'); const g = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')); const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--banner-h')); scrollTo(0, c.getBoundingClientRect().top + scrollY - g - bh); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}${tag}-maprow.png` });
    // keyboard: Tab until the list region has focus, then End scrolls it to the bottom
    let focused = false;
    for (let i = 0; i < 40 && !focused; i++) { await p.keyboard.press('Tab'); focused = await p.evaluate(() => document.activeElement && document.activeElement.id === 'cand-scroll'); }
    if (focused) { await p.keyboard.press('End'); await p.waitForTimeout(600); }
    const m1 = await measure();
    await p.screenshot({ path: `${out}${tag}-scrolled.png` });
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}${tag}-full.png`, fullPage: true });
    const minMap = m0.vh - m0.banner - 2 * m0.gutter;
    const checks = {
      mapAtLeastScreen: w > 960 ? m0.mapCard.h >= minMap - 1 : 'n/a',
      candBottomEqualsMap: w > 960 ? m0.cand.bottom === m0.mapCard.bottom : 'n/a',
      listScrolls: m0.scroll.sh > m0.scroll.h, fadeAtTop: m0.scroll.fade, keyboardFocus: focused, endScrolled: m1.scroll.top > 0, fadeGoneAtEnd: !m1.scroll.fade,
      allRows: m0.rows, olStart: m0.start, noButton: !m0.button, pageHeightStable: m1.docH === m0.docH,
      chartsEqual: m0.charts[0].card === m0.charts[1].card && m0.charts[0].plotTop === m0.charts[1].plotTop,
      overflowX: Math.max(m0.overflowX, m1.overflowX), errors: errs,
    };
    report[tag] = { checks, top: m0, end: m1 };
    console.log(tag, JSON.stringify(checks), 'minMap', minMap, 'mapCard', m0.mapCard.h, 'cand', m0.cand.h, 'scrollArea', m0.scroll.h + '/' + m0.scroll.sh, 'charts', m0.charts.map((c) => c.card).join('/'));
    if (tag === '1440x900-demo') fs.copyFileSync(`${out}${tag}-maprow.png`, `${out}sidebar-scroll-1440.png`);
    await ctx.close();
  }
  fs.writeFileSync(out + 'checks.json', JSON.stringify(report, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
