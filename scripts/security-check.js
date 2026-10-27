// Security checks against a running tracker. Usage: node scripts/security-check.js <port> <accessKey|''>
// Sends raw HTTP over a socket so paths reach the server un-normalized.
const net = require('net');
const [port = 8099, key = ''] = process.argv.slice(2);
function raw(reqText, { waitMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(+port, '127.0.0.1'); let buf = ''; const t0 = Date.now();
    s.on('data', (d) => { buf += d; }); s.on('error', () => {});
    s.on('close', () => resolve({ text: buf, ms: Date.now() - t0 }));
    s.setTimeout(waitMs, () => s.destroy());
    if (reqText) s.write(reqText);
  });
}
const get = (p, h = '', m = 'GET') => raw(`${m} ${p} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${h}\r\n`);
const status = (r) => Number((r.text.match(/^HTTP\/1\.1 (\d+)/) || [])[1] || 0);
const results = []; const check = (name, ok, info = '') => { results.push({ ok, name, info }); console.log(ok ? 'PASS' : 'FAIL', name, info); };
(async () => {
  let cookie = '';
  if (key) {
    const r = await get(`/?key=${encodeURIComponent(key)}`);
    const sc = (r.text.match(/^Set-Cookie: (.*)$/mi) || [])[1] || '';
    cookie = 'Cookie: ' + sc.split(';')[0] + '\r\n';
    check('gate: key sets cookie with HttpOnly, Secure, SameSite', /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc), sc.replace(/=[^;]+/, '=<token>'));
    check('gate: key redirected out of URL (303 to /)', status(r) === 303 && /^Location: \/\r?$/mi.test(r.text));
    check('gate: no cookie, page is 404', status(await get('/')) === 404);
    check('gate: no cookie, API is 404', status(await get('/api/state')) === 404);
    check('gate: wrong key is 404', status(await get('/?key=' + 'x'.repeat(key.length))) === 404);
    check('gate: forged cookie is 404', status(await get('/', 'Cookie: tk=abc\r\n')) === 404);
    check('gate: open redirect via //host blocked', /^Location: \/[^/]/mi.test((await get(`/.//evil.example/?key=${encodeURIComponent(key)}`)).text) );
    check('gate: unauthenticated POST is plain 404', status(await get('/', 'Content-Length: 0\r\n', 'POST')) === 404);
  }
  const ok200 = await get('/', cookie); check('index served', status(ok200) === 200);
  const hdr = ok200.text.split('\r\n\r\n')[0];
  for (const h of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'X-Robots-Tag'])
    check('header ' + h, new RegExp('^' + h + ':', 'mi').test(hdr));
  const csp = (hdr.match(/^Content-Security-Policy: (.*)$/mi) || [])[1] || '';
  check('CSP: no unsafe-inline / unsafe-eval', !/unsafe-(inline|eval)/.test(csp), csp);
  check('no X-Powered-By / server banner', !/^(X-Powered-By|Server):/mi.test(hdr));
  const probes = ['/.access_key', '/package.json', '/package-lock.json', '/server.js', '/data/history.jsonl', '/data/latest.json', '/logs/server.log', '/logs/', '/data/', '/public/', '/public/index.html', '/lib/demo.js', '/fixtures/unofficialresult.json', '/node_modules/leaflet/package.json', '/README.md', '/PUBLIC_URL.txt', '/.git/config', '/vendor/', '/vendor/leaflet/', '/vendor/leaflet/images/',
    '/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js', '/%252e%252e%252fserver.js', '/..%252fserver.js', '/..%5cserver.js', '/..\\server.js', '/vendor/leaflet/../../../server.js', '/vendor/leaflet/..%2f..%2f..%2fserver.js', '/index.html%00.js', '/index.html%00', '/%00', '/app.js/', '/app.js%2f', '/APP.JS', '/app.js::$DATA', '/./.access_key', '/%2eaccess_key', '//etc/passwd', '/vendor/leaflet/images/../../../.access_key', '/symlink-test.js'];
  for (const p of probes) { const r = await get(p, cookie); const s = status(r); check(`blocked ${p}`, s === 404 || s === 400, String(s)); }
  check('absolute-form target refused', [400, 404].includes(status(await get('http://evil.example/server.js', cookie))));
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'PROPFIND']) {
    const s = status(await get('/', cookie + 'Content-Length: 0\r\n', m)); check(`method ${m} refused`, s === 405, String(s)); }
  check('HEAD allowed, no body', await (async () => { const r = await get('/', cookie, 'HEAD'); return status(r) === 200 && r.text.split('\r\n\r\n')[1] === ''; })());
  check('GET with body refused', status(await get('/', cookie + 'Content-Length: 5\r\n\r\nhello')) === 413);
  check('URL > 2 KB refused', [404, 414].includes(status(await get('/?' + 'a'.repeat(3000), cookie))));
  check('headers > 8 KB refused', [431, 400].includes(status(await get('/', cookie + 'X-Big: ' + 'a'.repeat(9000) + '\r\n'))));
  check('malformed request gets 400', status(await raw('GARBAGE\r\n\r\n')) === 400);
  // slowloris: send a partial header and trickle; server must drop it within ~10 s headersTimeout
  const slow = await new Promise((resolve) => { const s = net.connect(+port, '127.0.0.1'); const t0 = Date.now(); s.resume(); s.write('GET / HTTP/1.1\r\nHost: x\r\n'); const iv = setInterval(() => s.write('X-a: b\r\n'), 1000); s.on('error', () => {}); s.on('close', () => { clearInterval(iv); resolve(Date.now() - t0); }); setTimeout(() => { clearInterval(iv); s.destroy(); resolve(99999); }, 40000); });
  check('slowloris socket dropped by the server', slow < 25000, `${(slow / 1000).toFixed(1)} s`);
  const idle = await raw('', { waitMs: 60000 }); check('idle socket dropped', idle.ms < 45000, `${(idle.ms / 1000).toFixed(1)} s`);
  const nf = await get('/nope', cookie); check('404 leaks no path or stack', !/\/workspace|\/Users|at .*\.js:\d+|Error/.test(nf.text));
  const api = await get('/api/state', cookie); check('API leaks no path or stack', !/\/workspace|\/Users|\/home\/|at .*\.js:\d+/.test(api.text));
  check('X-Forwarded-For ignored (same response)', status(await get('/api/state', cookie + 'X-Forwarded-For: 1.2.3.4\r\nCF-Connecting-IP: 1.2.3.4\r\n')) === 200);
  const fails = results.filter((r) => !r.ok); console.log(`\n${results.length - fails.length}/${results.length} passed`); process.exit(fails.length ? 1 : 0);
})();
