// Headless screenshots of live (zero) and demo modes. Usage: npm run screenshots [baseUrl]
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || `http://localhost:${process.env.PORT || 8026}`;
const out = path.join(__dirname, '..', 'screenshots');
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const shots = [
    ['live-zero-desktop.png', '/', { width: 1280, height: 900 }],
    ['demo-desktop.png', '/?demo=1&p=0.45', { width: 1280, height: 900 }],
    ['demo-complete-desktop.png', '/?demo=1&p=1', { width: 1280, height: 900 }],
    ['demo-mobile.png', '/?demo=1&p=0.45', { width: 390, height: 844 }],
    ['live-zero-mobile.png', '/', { width: 390, height: 844 }],
  ];
  // reduced motion: same page, every update lands immediately
  shots.push(['demo-reduced-motion.png', '/?demo=1&p=0.6', { width: 1280, height: 900 }, 'reduce']);
  for (const [name, url, vp, rm] of shots) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1, reducedMotion: rm || 'no-preference' });
    page.on('console', (m) => m.type() === 'error' && console.log(name, 'console error:', m.text()));
    page.on('pageerror', (e) => console.log(name, 'page error:', e.message));
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, name), fullPage: true });
    console.log('saved', path.join(out, name));
    await page.close();
  }
  // Interaction states: map tooltip and the Mayor-by-ward table
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '/?demo=1&p=0.45', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'demo-map-tooltip.png') });
  await page.click('button[data-race="mayor"]');
  await page.selectOption('#sort', 'margin');
  await page.locator('#wards-heading').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'demo-mayor-table.png') });
  console.log('saved demo-map-tooltip.png, demo-mayor-table.png');
  await page.close();

  // Simulated live updates (?demo=live): wait until the sample count is mid-night, then record ~20 s.
  const getP = async () => { const s = await (await fetch(base + '/api/state?demo=1&live=1')).json(); return s.mayor.pollsReceived / s.mayor.polls; };
  for (let i = 0; i < 120; i++) { const p = await getP(); if (p > 0.08 && p < 0.55) break; await new Promise((r) => setTimeout(r, 1000)); }
  const vdir = path.join(out, 'video-tmp');
  fs.rmSync(vdir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: vdir, size: { width: 1280, height: 900 } } });
  const vp = await ctx.newPage();
  vp.on('console', (m) => m.type() === 'error' && console.log('live-sim console error:', m.text()));
  vp.on('pageerror', (e) => console.log('live-sim page error:', e.message));
  await vp.goto(base + '/?demo=live', { waitUntil: 'networkidle' });
  await vp.waitForTimeout(9000);
  // mid-tween frame: right after an update lands, numbers and lines are between values
  await vp.waitForResponse((r) => r.url().includes('/api/state'));
  await vp.waitForTimeout(350);
  await vp.screenshot({ path: path.join(out, 'live-sim-mid-tween.png') });
  await vp.waitForTimeout(1500);
  await vp.screenshot({ path: path.join(out, 'live-sim-settled.png') });
  // hover a few table rows so the gliding highlight is in the recording, then scroll back up
  await vp.locator('#wards-heading').scrollIntoViewIfNeeded();
  const rows = vp.locator('#ward-rows tr');
  for (const i of [0, 1, 2, 4, 3]) { const bb = await rows.nth(i).boundingBox(); await vp.mouse.move(bb.x + 200, bb.y + bb.height / 2, { steps: 6 }); await vp.waitForTimeout(250); }
  await vp.screenshot({ path: path.join(out, 'live-sim-row-hover.png') });
  await vp.click('button[data-race="mayor"]');
  await vp.waitForTimeout(600);
  await vp.selectOption('#sort', 'margin');
  await vp.waitForTimeout(4500);
  await vp.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await vp.waitForTimeout(6000);
  const webm = await vp.video().path();
  await ctx.close();
  const mp4 = path.join(out, 'live-sim.mp4'), gif = path.join(out, 'live-sim.gif');
  const { execFileSync } = require('child_process');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-crf', '23', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-t', '12', '-i', webm, '-vf', 'fps=15,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', gif]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log('saved', mp4, gif);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
