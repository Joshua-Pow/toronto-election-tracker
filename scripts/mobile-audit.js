// Mobile audit: horizontal overflow, small touch targets, input font size, at phone sizes.
// Usage: node scripts/mobile-audit.js [baseUrl]
const { chromium, devices } = require('playwright-core');
const base = process.argv[2] || 'http://127.0.0.1:8026';
// The server gates every request behind ACCESS_KEY; pass it like the shared link does.
const key = (() => { try { return require('fs').readFileSync(__dirname + '/../.access_key', 'utf8').trim(); } catch { return ''; } })();
const withKey = (u) => key ? u + (u.includes('?') ? '&' : '?') + 'key=' + key : u;
const sizes = [['375x667', 375, 667], ['390x844', 390, 844], ['430x932', 430, 932], ['landscape 844x390', 844, 390]];
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  let bad = 0;
  for (const url of ['/', '/?demo=1&p=0.5']) for (const [name, w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + withKey(url), { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > vw + 1 && !e.closest('.table-wrap,.leaflet-container') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right));
      const small = [...document.querySelectorAll('a[href],button,select,input,summary,[role=button],.leaflet-control-zoom a')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && e.offsetParent && (b.height < 44 || b.width < 44) && !e.closest('.foot p,.leaflet-control-attribution') && !e.classList.contains('skip') && !(e.classList.contains('row-btn') && getComputedStyle(e, '::after').position === 'absolute'); }).map((e) => `${e.tagName}${e.id ? '#' + e.id : ''}.${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      const inputs = [...document.querySelectorAll('input,select,textarea')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id);
      const tw = document.querySelector('.table-wrap');
      return { docOverflow: document.documentElement.scrollWidth - vw, over, small: [...new Set(small)].slice(0, 12), smallCount: small.length, inputs, tableScroll: tw ? tw.scrollWidth - tw.clientWidth : null };
    });
    const ok = r.docOverflow <= 0 && !r.over.length && !r.smallCount && !r.inputs.length;
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : 'BAD'} ${url} ${name}`, JSON.stringify(r));
    await ctx.close();
  }
  await browser.close(); process.exit(bad ? 1 : 0);
})();
