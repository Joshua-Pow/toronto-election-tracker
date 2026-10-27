'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1' || params.get('demo') === 'live';
  const SIM = DEMO && (params.get('demo') === 'live' || params.get('live') === '1') && !params.has('p');
  const API = '/api/state' + (DEMO ? '?demo=1' + (SIM ? '&live=1' : '') + (params.has('p') ? '&p=' + encodeURIComponent(params.get('p')) : '') : '');
  // The browser asks our server. The server reads the City file 1s after each publication
  // (about once a minute) and every 20s until that file changes. Wake at most every 20s,
  // and when the server's next check is sooner, ask about 1.2s after nextCheckAt.
  // ?demo=live follows the sample nextCheckAt (about every 4s).
  const CLIENT_CAP_MS = 20000;
  const CLIENT_LAG_MS = 1200;
  const { setNum, setBar, setText, reorder, NUM_HTML } = window.Fluid;
  const TZ = 'America/Toronto';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat('en-CA');
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtHM = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fmtHMS = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const etParts = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t).map((p) => [p.type, p.value]));
  const et = (t, withDay) => {
    if (!t) return 'n/a';
    const sameDay = fmtDay.format(t) === fmtDay.format(Date.now());
    return `${fmtTime.format(t)} ET${withDay || !sameDay ? ', ' + fmtDay.format(t) : ''}`;
  };
  const pct = (x, d = 1) => (x == null ? 'n/a' : x.toFixed(d) + '%');
  // DOM helper: feed strings (candidate and ward names) only ever go in as text, never as HTML.
  const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const dot = (bg) => { const i = document.createElement('i'); i.style.background = bg; return i; };
  // Campaign and social links live in /mayors.js (City Clerk candidate list). Feed names stay text.
  function mayorProfile(name) {
    const book = window.MAYOR_PROFILES && window.MAYOR_PROFILES.byName;
    const p = book && book[name];
    return p && p.office === 'Mayor' && Array.isArray(p.links) ? p : null;
  }
  function safeLinkHref(href) {
    try {
      const u = new URL(href);
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return '';
      return u.href;
    } catch { return ''; }
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Brand marks are the Simple Icons paths (simpleicons.org, CC0), filled with the text colour.
  // CSS sizes them to cap height. A campaign site is not a brand, so it stays a diagonal arrow.
  // Same destination: ignore a trailing slash, and treat http and https as one when host and path match.
  function linkKey(href) {
    const safe = safeLinkHref(href);
    if (!safe) return '';
    const u = new URL(safe);
    const path = u.pathname.replace(/\/+$/, '');
    const scheme = u.protocol === 'http:' || u.protocol === 'https:' ? 'http:' : u.protocol;
    return scheme + '//' + u.host.toLowerCase() + path + u.search;
  }
  const LINK_ICON = {
    site: '<path d="M4.5 11.5 11.5 4.5M7.2 4.5H11.5V8.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/>',
    instagram: '<path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/>',
    facebook: '<path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/>',
    linkedin: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>',
    threads: '<path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"/>',
    youtube: '<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>',
    tiktok: '<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
    substack: '<path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/>',
  };
  function iconKind(item) {
    if (item.kind === 'social') {
      const p = String(item.platform || '').toLowerCase();
      if (p === 'twitter') return 'x';
      if (LINK_ICON[p]) return p;
    }
    return 'site';
  }
  function iconSvg(kind) {
    const svg = document.createElementNS(SVGNS, 'svg');
    const brand = kind !== 'site';
    svg.setAttribute('viewBox', brand ? '0 0 24 24' : '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (brand) svg.setAttribute('fill', 'currentColor');
    svg.innerHTML = LINK_ICON[kind] || LINK_ICON.site;
    return svg;
  }
  function whereTo(item) {
    const href = safeLinkHref(item.href);
    let host = '';
    try { host = new URL(href).host.replace(/^www\./, ''); } catch { /* keep the label */ }
    const label = String(item.label || '').trim();
    if (!label) return host || href;
    if (host && !label.toLowerCase().includes(host.toLowerCase())) return label + ' (' + host + ')';
    return label;
  }
  function iconLink(item) {
    const href = safeLinkHref(item.href);
    if (!href) return null;
    const a = document.createElement('a');
    a.className = 'ext-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', item.label || 'Link');
    a.dataset.tip = whereTo(item);
    a.append(iconSvg(iconKind(item)));
    return a;
  }
  function primarySite(name) {
    const links = (mayorProfile(name) || { links: [] }).links;
    return links.find((item) => item.kind === 'campaign' && safeLinkHref(item.href))
      || links.find((item) => item.kind === 'site' && safeLinkHref(item.href))
      || null;
  }
  // The name goes to the campaign site. Other pages and social accounts are icons beside it.
  function paintIdentity(host, name) {
    const site = primarySite(name);
    let link = host.querySelector('.nm-link');
    const nm = link.querySelector('.nm');
    const want = site ? 'A' : 'SPAN';
    if (link.tagName !== want) {
      const next = document.createElement(site ? 'a' : 'span');
      next.className = 'nm-link';
      next.append(nm);
      link.replaceWith(next);
      link = next;
    }
    const mark = link.querySelector('svg');
    if (site) {
      link.href = safeLinkHref(site.href);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      if (!mark) link.append(iconSvg('site'));
    } else if (mark) mark.remove();
    const ext = host.querySelector('.ext');
    const seen = new Set();
    const siteKey = site ? linkKey(site.href) : '';
    if (siteKey) seen.add(siteKey);
    const extraSites = [];
    const socials = [];
    for (const item of (mayorProfile(name) || { links: [] }).links) {
      if (item === site) continue;
      const href = safeLinkHref(item.href);
      const key = href && linkKey(href);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // A second website is not another arrow. It is named in the name-link tooltip.
      if (iconKind(item) === 'site') extraSites.push(item);
      else socials.push(item);
    }
    if (site) {
      link.dataset.tip = [whereTo(site), ...extraSites.map(whereTo)].join('\n');
      link.setAttribute('aria-description', link.dataset.tip.replace(/\n/g, '. '));
    } else {
      delete link.dataset.tip;
      link.removeAttribute('aria-description');
    }
    const rest = socials;
    const sig = rest.map((item) => item.href).join('|');
    if (ext.dataset.sig !== sig) {
      ext.dataset.sig = sig;
      ext.replaceChildren(...rest.map(iconLink).filter(Boolean));
    }
    ext.hidden = rest.length === 0;
  }
  // One shared tooltip, positioned on the icon, so a scrolling candidate list cannot clip it.
  const tipPop = h('p', 'status-pop');
  tipPop.hidden = true;
  tipPop.setAttribute('role', 'tooltip');
  document.body.append(tipPop);
  function hideStatus() { tipPop.hidden = true; tipPop.dataset.for = ''; document.querySelectorAll('.status-tip[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function placeTip(el, text, key) {
    tipPop.replaceChildren();
    String(text || '').split('\n').forEach((line, i) => {
      if (i) tipPop.append(document.createElement('br'));
      tipPop.append(document.createTextNode(line));
    });
    tipPop.hidden = false;
    tipPop.dataset.for = key;
    const r = el.getBoundingClientRect();
    const w = tipPop.offsetWidth;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    let top = r.top - tipPop.offsetHeight - 6;
    if (top < 8) top = r.bottom + 6;
    tipPop.style.left = left + 'px';
    tipPop.style.top = top + 'px';
  }
  function showStatus(btn) { btn.setAttribute('aria-expanded', 'true'); placeTip(btn, btn.dataset.note, btn.id); }
  function linkAnchor(node) {
    const a = node && node.closest && node.closest('a.nm-link, a.ext-link');
    return a && a.dataset.tip ? a : null;
  }
  function showLinkTip(a) {
    document.querySelectorAll('.status-tip[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    placeTip(a, a.dataset.tip, a.href);
  }
  function statusTip(name, slot) {
    const note = (mayorProfile(name) || {}).note;
    if (!note) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-tip';
    btn.id = 'status-tip-' + slot + '-' + name.toLowerCase().replace(/[^a-z]+/g, '-');
    btn.dataset.note = note;
    btn.setAttribute('aria-label', name + ': ' + note);
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M8 7.25v3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="8" cy="4.7" r="0.7" fill="currentColor"/></svg>';
    let touch = false;
    btn.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') showStatus(btn); });
    btn.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && document.activeElement !== btn) hideStatus(); });
    btn.addEventListener('focus', () => showStatus(btn));
    btn.addEventListener('blur', hideStatus);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!touch) return;
      e.preventDefault();
      if (tipPop.hidden || tipPop.dataset.for !== btn.id) showStatus(btn); else hideStatus();
    });
    return btn;
  }
  document.addEventListener('click', hideStatus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideStatus(); });
  addEventListener('scroll', hideStatus, true);
  addEventListener('resize', hideStatus);
  // Hover and keyboard focus say where a name or social icon goes. Touch still follows the link.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const a = linkAnchor(e.target);
    if (!a) return;
    showLinkTip(a);
  });
  document.addEventListener('pointerout', (e) => {
    const a = linkAnchor(e.target);
    if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    if (tipPop.dataset.for === a.href) hideStatus();
  });
  document.addEventListener('focusin', (e) => { const a = linkAnchor(e.target); if (a) showLinkTip(a); });
  document.addEventListener('focusout', (e) => {
    const a = linkAnchor(e.target);
    if (a && tipPop.dataset.for === a.href && !(e.relatedTarget && a.contains(e.relatedTarget))) hideStatus();
  });

  // Candidate colours. Colour is never the only cue: names always appear beside it.
  const KNOWN = { 'Olivia Chow': 'var(--chow)', 'Brad Bradford': 'var(--bradford)', 'Chris Alexander': 'var(--alexander)' };
  const KNOWN_HEX = { 'Olivia Chow': '#7b4ea3', 'Brad Bradford': '#3f8a55', 'Chris Alexander': '#3fa7b4' };
  const INK = { 'Olivia Chow': 'var(--chow-ink)', 'Brad Bradford': 'var(--bradford-ink)', 'Chris Alexander': 'var(--alexander-ink)' };
  const OTHER_HEX = '#7d7a74';
  const colorFor = (name) => KNOWN[name] || 'var(--other)';
  const hexFor = (name) => KNOWN_HEX[name] || OTHER_HEX;
  const COUNCIL_PALETTE = ['#4b6cb7', '#c0603a', '#2a8c82', '#a3478f', '#8a7a2a', '#5b5f97'];
  const councilColor = (name) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COUNCIL_PALETTE[h % COUNCIL_PALETTE.length]; };

  let state = null;
  let prev = null;
  let race = 'council';
  let map, wardLayer, geo;
  let lastFetchOk = null;
  let lastLoadOk = false;
  let loadGen = 0;

  if (DEMO) {
    $('sample-banner').hidden = false;
    $('sample-detail').textContent = SIM ? 'Not real results.' : 'Made-up numbers. Not real results.';
    $('sim-toggle').hidden = false;
    // Pause freezes the sample at its current progress (?demo=1&p=…); Play resumes the moving simulation.
    $('sim-toggle').replaceChildren(SIM ? 'Pause' : 'Play', h('span', 'wide-only', '\u00a0simulation'));
    $('sim-toggle').href = SIM ? '/?demo=1&p=0.5' : '/?demo=live';
    $('sample-chip').hidden = false;
    document.title = 'SAMPLE DATA: ' + document.title;
  }

  // ---------- data ----------
  async function load() {
    const gen = ++loadGen;
    try {
      const res = await fetch(API, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const next = await res.json();
      if (gen !== loadGen) return;
      if (DEMO && !next.sample) throw new Error('Expected sample data in demo mode');
      if (!DEMO && next.sample) throw new Error('Refusing sample data in live mode');
      prev = state; state = next; lastFetchOk = Date.now(); lastLoadOk = true;
      render();
      setConn(!next.error, "Can't reach the City's results feed");
    } catch (e) {
      if (gen !== loadGen) return;
      lastLoadOk = false;
      setConn(false, 'Lost connection to the tracker');
      showError(`Can't reach the tracker server (${e.message}).${state ? ' Showing the last numbers received.' : ''} Retrying.`);
    }
  }

  function showError(msg) {
    const el = $('error-banner');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = msg;
  }

  // ---------- render ----------
  function render() {
    const s = state;
    const m = s.mayor;
    const hasVotes = !!(m && m.total > 0);
    const allIn = !!(m && m.polls && m.pollsReceived >= m.polls);

    if (s.error) showError(`Couldn't reach the City's results feed at ${et(s.error.at)} (${s.error.message}).${s.lastCheckAt ? ' Showing data last received at ' + et(s.lastCheckAt) + '.' : ''} Retrying.`);
    else showError(null);

    // status line
    const dot = $('status-dot');
    let label;
    if (!m) { label = 'Waiting for the City feed'; dot.dataset.state = 'waiting'; }
    else if (!hasVotes) { label = 'Waiting for first results'; dot.dataset.state = 'waiting'; }
    else if (allIn) { label = 'Unofficial results, all polls reported'; dot.dataset.state = 'done'; }
    else { label = 'Unofficial results, counting'; dot.dataset.state = 'live'; }
    $('status-label').textContent = label;
    const polls = m ? m.polls : 1431;
    const rec = m ? m.pollsReceived : 0;
    setNum($('polls-rec'), rec, (v) => fmtInt.format(Math.round(v)));
    $('polls-total').textContent = fmtInt.format(polls);
    const prog = $('progress');
    prog.setAttribute('aria-valuemax', polls); prog.setAttribute('aria-valuenow', rec);
    setBar($('progress-fill'), polls ? rec / polls : 0);

    // leaders / zero state
    const zero = $('zero-state');
    const leaders = $('leaders');
    if (!hasVotes) {
      leaders.hidden = true;
      zero.hidden = false;
      const p = etParts(Date.now());
      const isNight = p.year === '2026' && p.month === '10' && p.day === '26';
      const before8 = isNight ? Number(p.hour) < 20 : (p.year === '2026' && (Number(p.month) < 10 || (p.month === '10' && Number(p.day) < 26)));
      zero.replaceChildren(h('strong', null, before8 ? 'Polls close at 8 PM ET.' : 'Polls closed at 8 PM ET.'));
      zero.append(document.createTextNode(before8
        ? ' The City posts its first results after that. The City publishes about once a minute. This page reads the City\'s results feed one second after each publication, and every 20 seconds until the file starts changing. You can leave it open.'
        : ' No results in the City\'s results feed yet. The City publishes about once a minute. This page reads that file one second after each publication, and every 20 seconds until the file starts changing.'));
    } else {
      zero.hidden = true;
      leaders.hidden = false;
      // mayor.candidates is already votes descending, name order on a tie. Row 0 is the highest.
      m.candidates.slice(0, 2).forEach((c, i) => renderLeader(i, c));
    }

    // freshness
    $('checked').textContent = s.lastCheckAt ? et(s.lastCheckAt) : 'not yet';
    $('published').textContent = s.publishedAt ? et(s.publishedAt) + (s.sample ? ' (sample)' : '') : 'n/a';
    if (SIM && s.progress != null) $('sim-toggle').href = `/?demo=1&p=${s.progress.toFixed(3)}`;
    tickCountdown();

    renderLegend();
    renderMap();
    renderCharts();
    renderCandidates();
    renderTable();
    announceChanges();
  }

  // Two persistent leader slots: numbers roll, a new name crossfades, colour fades.
  // Slot i follows mayor.candidates, which is votes descending (name order when votes tie).
  function renderLeader(i, c) {
    let el = $('leaders').children[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'leader';
      // one row of the leaders grid: name, share, votes. Columns come from the parent (subgrid).
      el.innerHTML = `<span class="leader-name"><i></i><span class="nm-link"><span class="nm"></span></span><span class="ext" hidden></span></span><span class="leader-pct">${NUM_HTML}</span><span class="leader-votes">${NUM_HTML}<span class="unit"> votes</span></span>`;
      $('leaders').appendChild(el);
    }
    setText(el.querySelector('.leader-name .nm'), c.name);
    const nameEl = el.querySelector('.leader-name');
    paintIdentity(nameEl, c.name);
    let mark = nameEl.querySelector('.status-tip');
    const note = (mayorProfile(c.name) || {}).note;
    if (!note) { if (mark) mark.remove(); }
    else if (!mark) nameEl.append(statusTip(c.name, 'leader' + i));
    el.querySelector('.leader-name i').style.background = colorFor(c.name);
    el.querySelector('.leader-pct').style.color = INK[c.name] || 'var(--ink)';
    setNum(el.querySelector('.leader-pct .tw'), c.pct, (v) => v.toFixed(1) + '%');
    setNum(el.querySelector('.leader-votes .tw'), c.votes, (v) => fmtInt.format(Math.round(v)));
  }

  function tickCountdown() {
    if (!state) return;
    const el = $('next-check');
    if (!state.nextCheckAt) { el.textContent = 'not scheduled'; return; }
    const secs = Math.max(0, Math.round((state.nextCheckAt - (Date.now() - (lastFetchOk ? 0 : 0))) / 1000));
    el.textContent = secs > 0 ? `in ${secs} s` : 'checking now';
  }
  setInterval(tickCountdown, 1000);

  // ---------- legend ----------
  function renderLegend() {
    const names = new Set(['Olivia Chow', 'Brad Bradford', 'Chris Alexander']);
    const leadersInWards = new Set((state.wards || []).map((w) => w.mayor && w.mayor.leader).filter(Boolean));
    const anyOther = [...leadersInWards].some((n) => !names.has(n));
    const sw = (bg, cls) => { const x = h('span', 'sw' + (cls ? ' ' + cls : '')); if (bg) x.style.background = bg; return x; };
    const li = (swatch, text) => { const x = h('li'); x.append(swatch, document.createTextNode(text)); return x; };
    const items = [...names].map((n) => { const item = li(sw(colorFor(n)), n); const mark = statusTip(n, 'legend'); if (mark) item.append(mark); return item; });
    items.push(li(sw('var(--other)'), 'Anyone else'));
    items.push(li(sw('var(--tie)'), 'Tie'));
    items.push(li(sw(null, 'sw-none'), 'No results yet'));
    $('legend-leaders').replaceChildren(...items);
  }

  // ---------- map ----------
  function shareOpacity(p) { return p == null ? 0 : p < 40 ? 0.32 : p < 50 ? 0.5 : p < 60 ? 0.68 : 0.88; }
  function wardStyle(w) {
    const mm = w && w.mayor;
    if (!mm || !mm.total) return { fillColor: '#ebe8e2', fillOpacity: 0.7, color: '#8f8a80', weight: 1, dashArray: '3 3' };
    if (mm.tie) return { fillColor: '#d4d1cb', fillOpacity: 0.9, color: '#5e5a52', weight: 1, dashArray: null };
    return { fillColor: hexFor(mm.leader), fillOpacity: shareOpacity(mm.leaderPct), color: '#3d3a35', weight: 1, dashArray: null };
  }
  // Ward details, built as DOM so feed names are text. Used by the desktop hover tip and the tap panel.
  // Lines and a small table instead of separators; the panel variant wraps the council line instead of truncating.
  function wardDetails(w, { head = true } = {}) {
    const mm = w && w.mayor;
    const box = h('div');
    if (head) { const hd = h('h4'); hd.append(h('span', 'tip-num', `Ward ${w.num}`), document.createTextNode(' ' + w.name)); box.append(hd); }
    if (!mm || !mm.total) { box.append(h('div', 'sub', mm ? `No mayoral results yet, 0 of ${fmtInt.format(mm.polls)} polls` : 'No mayoral results yet')); return box; }
    const meta = h('div', 'sub tip-meta', `${fmtInt.format(mm.pollsReceived)} of ${fmtInt.format(mm.polls)} polls reporting`);
    if (DEMO) meta.append(' ', h('span', 'tip-sample', 'SAMPLE DATA'));
    box.append(meta);
    const t = h('table', 'tip-table'), th = h('tr', 'tip-head');
    th.append(h('th', null, 'Mayor'), h('th', 'r', 'Share'), h('th', 'r', 'Votes')); t.append(th);
    mm.candidates.slice(0, 4).forEach((c, i) => {
      const tr = h('tr', i === 0 ? 'lead' : ''), who = h('span', 'who');
      who.append(dot(colorFor(c.name)), document.createTextNode(c.name));
      const td = h('td'); td.append(who);
      tr.append(td, h('td', 'r', pct(c.pct)), h('td', 'r', fmtInt.format(c.votes))); t.append(tr);
    });
    box.append(t);
    box.append(h('div', 'sub tip-lead', mm.tie ? 'Tied' : gapText(mm)));
    if (w.council && w.council.leader && w.council.marginVotes != null) box.append(h('div', 'sub tip-council', `Councillor: ${w.council.leader} ${w.council.tie ? 'tied' : gapText(w.council).replace(/^L/, 'l')}`));
    return box;
  }
  // "Leads by 120 votes (0.6 pts)"
  function gapText(r) {
    const v = r.marginVotes || 0;
    return `Leads by ${fmtInt.format(v)} ${v === 1 ? 'vote' : 'votes'}${r.marginPts != null ? ` (${r.marginPts.toFixed(1)}\u00a0pts)` : ''}`;
  }
  // Hover tips only where hover is real and there is room; touch and narrow screens use the tap panel.
  const hoverTips = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 641px)');
  const wardInfo = (num) => (state && state.wards.find((w) => String(w.num) === String(num))) || (() => {
    const f = geo && geo.features.find((x) => String(x.properties.num) === String(num));
    return f ? { num: f.properties.num, name: f.properties.name } : null;
  })();
  let selected = null, tipNum = null, tipPt = null;
  const layerFor = (num) => { let t; wardLayer && wardLayer.eachLayer((l) => { if (String(l.feature.properties.num) === String(num)) t = l; }); return t; };
  const restWeight = (num) => (String(num) === String(selected) ? 3.5 : 1);

  // Desktop tip: our own element inside the map, flipped and clamped so it never leaves the map or clips a column.
  let tipEl;
  function placeTip() {
    if (!tipEl || tipNum == null || !tipPt) return;
    const mw = map.getSize().x, mh = map.getSize().y, pad = 8, gap = 14;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = tipPt.x + gap, y = tipPt.y - th - gap;          // preferred: above right of the pointer
    if (x + tw > mw - pad) x = tipPt.x - tw - gap;          // flip left
    if (y < pad) y = tipPt.y + gap;                          // flip below
    x = Math.min(Math.max(pad, x), Math.max(pad, mw - tw - pad));
    y = Math.min(Math.max(pad, y), Math.max(pad, mh - th - pad));
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  // Hover card stays one width: the longest ward title or top-4 mayor name, plus fixed number columns.
  // Moving between wards updates that shell in place so only the figures roll.
  const HOVER_NUM = { type: 'spring', duration: 0.32, bounce: 0 };
  let tipNameKey = '';
  function hoverSkeleton() {
    const box = h('div', 'tip-body');
    const hd = h('h4');
    hd.append(h('span', 'tip-num'), document.createTextNode(' '), h('span', 'tip-ward'));
    const t = h('table', 'tip-table');
    const cols = document.createElement('colgroup');
    cols.append(h('col', 'tip-col-name'), h('col', 'tip-col-share'), h('col', 'tip-col-votes'));
    t.append(cols);
    const th = h('tr', 'tip-head');
    th.append(h('th', null, 'Mayor'), h('th', 'r', 'Share'), h('th', 'r', 'Votes'));
    t.append(th);
    for (let i = 0; i < 4; i++) {
      const tr = h('tr', i === 0 ? 'lead tip-row' : 'tip-row');
      const who = h('span', 'who');
      who.append(dot('transparent'), h('span', 'nm'));
      const nameCell = h('td'); nameCell.append(who);
      const share = h('td', 'r tip-share'); share.innerHTML = NUM_HTML;
      const votes = h('td', 'r tip-votes'); votes.innerHTML = NUM_HTML;
      tr.append(nameCell, share, votes);
      t.append(tr);
    }
    const meta = h('div', 'sub tip-meta');
    meta.append(h('span', 'tip-meta-text'), h('span', 'tip-sample', 'SAMPLE DATA'));
    box.append(hd, meta, t, h('div', 'sub tip-lead'), h('div', 'sub tip-council'));
    return box;
  }
  function lockHoverWidth() {
    if (!tipEl || !state || !state.wards || !state.wards.length) return;
    const key = state.wards.map((w) => w.num + '\t' + w.name + '\t' + ((w.mayor && w.mayor.candidates) || []).slice(0, 4).map((c) => c.name).join('|')).join('\n') + '\t' + (map ? map.getSize().x : 0);
    if (key === tipNameKey) return;
    tipNameKey = key;
    const probe = h('div', 'ward-tip map-tip');
    probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;width:max-content;max-width:none';
    const title = h('h4');
    const who = h('span', 'who');
    who.append(dot('#000'), document.createTextNode(''));
    probe.append(title, who);
    document.body.append(probe);
    let max = 0;
    const nm = who.lastChild;
    for (const w of state.wards) {
      title.textContent = 'Ward ' + w.num + ' ' + w.name;
      max = Math.max(max, title.getBoundingClientRect().width);
      for (const c of ((w.mayor && w.mayor.candidates) || []).slice(0, 4)) {
        nm.textContent = c.name;
        max = Math.max(max, who.getBoundingClientRect().width);
      }
    }
    probe.remove();
    const share = 68, votes = 76, pad = 24;
    const cap = Math.min(380, Math.max(240, (map ? map.getSize().x : 800) - 16));
    const width = Math.min(cap, Math.max(240, Math.ceil(max) + share + votes + pad));
    tipEl.style.width = width + 'px';
    tipEl.style.setProperty('--tip-name', (width - pad - share - votes) + 'px');
  }
  function paintHoverTip(w) {
    const first = tipEl.dataset.painted !== '1';
    tipEl.dataset.painted = '1';
    const instant = first || reduceMotion.matches;
    tipEl.querySelector('.tip-num').textContent = 'Ward ' + w.num;
    tipEl.querySelector('.tip-ward').textContent = ' ' + w.name;
    const mm = w && w.mayor;
    const metaText = tipEl.querySelector('.tip-meta-text');
    const sample = tipEl.querySelector('.tip-sample');
    const table = tipEl.querySelector('.tip-table');
    const lead = tipEl.querySelector('.tip-lead');
    const council = tipEl.querySelector('.tip-council');
    if (sample) sample.hidden = !DEMO;
    if (!mm || !mm.total) {
      table.hidden = true; lead.hidden = true; council.hidden = true;
      metaText.textContent = mm ? `No mayoral results yet, 0 of ${fmtInt.format(mm.polls)} polls` : 'No mayoral results yet';
      return;
    }
    table.hidden = false; lead.hidden = false;
    metaText.textContent = `${fmtInt.format(mm.pollsReceived)} of ${fmtInt.format(mm.polls)} polls reporting`;
    const cands = mm.candidates.slice(0, 4);
    tipEl.querySelectorAll('.tip-row').forEach((tr, i) => {
      const c = cands[i];
      tr.hidden = !c;
      if (!c) return;
      tr.querySelector('.who i').style.background = colorFor(c.name);
      tr.querySelector('.nm').textContent = c.name;
      const opt = { instant, tier: HOVER_NUM };
      setNum(tr.querySelector('.tip-share .tw'), c.pct, (v) => v.toFixed(1) + '%', opt);
      setNum(tr.querySelector('.tip-votes .tw'), c.votes, (v) => fmtInt.format(Math.round(v)), opt);
    });
    lead.textContent = mm.tie ? 'Tied' : gapText(mm);
    const councilText = w.council && w.council.leader && w.council.marginVotes != null
      ? `Councillor: ${w.council.leader} ${w.council.tie ? 'tied' : gapText(w.council).replace(/^L/, 'l')}` : '';
    council.hidden = !councilText;
    if (councilText) council.textContent = councilText;
  }
  function showTip(num, pt) {
    const w = wardInfo(num); if (!w || !tipEl) return;
    if (!tipEl.querySelector('.tip-table')) tipEl.replaceChildren(hoverSkeleton());
    lockHoverWidth();
    if (String(tipNum) !== String(num)) paintHoverTip(w);
    tipNum = num;
    tipPt = pt; tipEl.hidden = false; placeTip();
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; tipNum = null; }

  // Tap / click / keyboard selection: details panel under the map, inside the map card.
  const panel = $('ward-panel'), panelTitle = $('wp-title'), panelBody = $('wp-content');
  let opener = null, closeTimer = 0;
  function fillPanel() {
    const w = wardInfo(selected); if (!w) return;
    panelTitle.replaceChildren(h('span', 'tip-num', `Ward ${w.num}`), document.createTextNode(' ' + w.name));
    panelBody.replaceChildren(wardDetails(w, { head: false }));
  }
  function selectWard(num, { from = null, focus = false } = {}) {
    if (!wardLayer) return;
    if (selected != null && String(selected) === String(num)) return clearSelection();
    const target = layerFor(num); if (!target) return;
    const prevSel = selected; selected = num;
    if (prevSel != null) { const pl = layerFor(prevSel); pl && pl.setStyle({ weight: 1 }); }
    target.setStyle({ weight: 3.5 }); target.bringToFront();
    const el = target.getElement(); el && el.classList.add('is-selected');
    if (prevSel != null) { const pe = layerFor(prevSel); pe && pe.getElement() && pe.getElement().classList.remove('is-selected'); }
    document.querySelectorAll('tr.is-hl').forEach((r) => r.classList.remove('is-hl'));
    const row = document.querySelector(`#ward-rows tr[data-ward="${CSS.escape(String(num))}"]`); if (row) row.classList.add('is-hl');
    fillPanel();
    clearTimeout(closeTimer);
    if (panel.hidden) { panel.hidden = false; void panel.offsetHeight; }
    panel.classList.add('open');
    if (from) opener = from;
    const w = wardInfo(num), mm = w && w.mayor;
    $('ward-live').textContent = `Ward ${w.num} ${w.name} selected. ` + (mm && mm.total ? `${mm.tie ? 'Tied' : mm.candidates[0].name + ' leads with ' + pct(mm.candidates[0].pct)}.` : 'No mayoral results yet.') + (DEMO ? ' Sample data.' : '');
    hideTip();
    if (focus) panelTitle.focus({ preventScroll: true });
    // keep the selected ward on screen (after a list tap or if the user had zoomed in)
    if (!map.getBounds().contains(target.getBounds())) map.panTo(target.getBounds().getCenter(), { animate: !reduceMotion.matches });
  }
  function clearSelection({ restoreFocus = false } = {}) {
    if (selected == null) return;
    const l = layerFor(selected);
    if (l) { l.setStyle({ weight: 1 }); l.getElement() && l.getElement().classList.remove('is-selected'); }
    document.querySelectorAll('tr.is-hl').forEach((r) => r.classList.remove('is-hl'));
    selected = null;
    panel.classList.remove('open');
    closeTimer = setTimeout(() => { panel.hidden = true; }, reduceMotion.matches ? 0 : 180);
    $('ward-live').textContent = 'Ward details closed.';
    if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  $('wp-close').addEventListener('click', () => clearSelection({ restoreFocus: true }));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSelection({ restoreFocus: true }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected != null && !panel.contains(document.activeElement)) clearSelection(); });
  // tapping outside closes; taps on wards, the list, the panel and map controls are handled by those
  document.addEventListener('click', (e) => {
    if (selected == null) return;
    if (e.target.closest('#ward-panel, .ward-shape, #ward-rows, .leaflet-control, .sample-banner')) return;
    clearSelection();
  });

  function fitWards() {
    if (!wardLayer) return;
    const b = wardLayer.getBounds(), padding = L.point(8, 8);
    map.setMinZoom(0);
    const fitZoom = map.getBoundsZoom(b, false, padding);
    map.setMinZoom(Math.max(0, fitZoom - 0.75));   // a little room to zoom out, never out to Hamilton
    map.fitBounds(b, { padding: [8, 8], animate: false });
  }
  async function initMap() {
    // Touch: one finger scrolls the page (no scroll trap); two fingers pinch to zoom and move the map.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    map = L.map('map', { zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true, dragging: !coarse, touchZoom: true, tapTolerance: 15,
      doubleClickZoom: !coarse, // a quick second tap on a ward closes its panel instead of zooming
      maxBoundsViscosity: 0.7, zoomControl: true });
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    const attribution = 'Leaflet, tiles © Esri, HERE, Garmin, © OpenStreetMap contributors';
    map.attributionControl.setPrefix(false); // Leaflet's prefix adds a "|" separator; credit Leaflet in the text instead
    map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
    geo = await (await fetch('/wards.geojson')).json();
    wardLayer = L.geoJSON(geo, {
      style: () => ({ className: 'ward-shape', ...wardStyle(null) }),
      onEachFeature: (f, layer) => {
        const num = f.properties.num;
        layer.on('mouseover', (e) => { layer.setStyle({ weight: Math.max(2.5, restWeight(num)) }); if (hoverTips.matches) showTip(num, e.containerPoint); });
        layer.on('mousemove', (e) => { if (hoverTips.matches && tipNum === num) { tipPt = e.containerPoint; placeTip(); } });
        layer.on('mouseout', () => { layer.setStyle({ weight: restWeight(num) }); hideTip(); });
        layer.on('click', () => selectWard(num));
      },
    });
    // Fit to the 25 wards before any tiles load, so the first paint is Toronto, not the Golden Horseshoe.
    const b = wardLayer.getBounds();
    map.setMaxBounds(b.pad(0.35));
    fitWards();
    L.tileLayer(esri + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution, bounds: b.pad(0.6) }).addTo(map);
    L.tileLayer(esri + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'labels', bounds: b.pad(0.6) }).addTo(map);
    wardLayer.addTo(map);
    // Reset view control, a 44 px button under zoom
    const Reset = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar map-reset');
      const a = L.DomUtil.create('button', 'map-reset-btn', bar);
      a.type = 'button'; a.title = 'Reset view'; a.setAttribute('aria-label', 'Reset map view to all 25 wards');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', () => { fitWards(); });
      return bar;
    } });
    new Reset().addTo(map);
    tipEl = L.DomUtil.create('div', 'ward-tip map-tip', map.getContainer());
    tipEl.hidden = true; tipEl.setAttribute('aria-hidden', 'true');
    map.on('movestart zoomstart', hideTip);
    // Refit on real size changes (orientation, window resize); the map height uses svh so iOS toolbars don't trigger this.
    let lastW = 0, lastH = 0, rt = 0;
    new ResizeObserver(() => {
      const el = map.getContainer(), wpx = el.clientWidth, hpx = el.clientHeight;
      if (!wpx || !hpx || (wpx === lastW && hpx === lastH)) return;
      lastW = wpx; lastH = hpx;
      clearTimeout(rt);
      rt = setTimeout(() => { map.invalidateSize({ animate: false }); fitWards(); }, 120);
    }).observe(map.getContainer());
    if (state) renderMap();
  }
  const wardFor = (f) => state && state.wards.find((w) => String(w.num) === String(f.properties.num));
  function renderMap() {
    if (!wardLayer) return;
    wardLayer.eachLayer((layer) => {
      const st = { ...wardStyle(wardFor(layer.feature)), weight: restWeight(layer.feature.properties.num) };
      layer.setStyle(st);
      // Inline style so the CSS transition crossfades the fill when a ward's leader or share changes
      const el = layer.getElement && layer.getElement();
      if (el) { el.style.fill = st.fillColor; el.style.fillOpacity = st.fillOpacity; }
    });
    if (selected != null) fillPanel();
    if (tipNum != null && tipEl && !tipEl.hidden) { const w = wardInfo(tipNum); if (w) { lockHoverWidth(); paintHoverTip(w); placeTip(); } }
  }

  // ---------- charts (D3 scales + Motion springs, see charts.js) ----------
  let shareChart, marginChart;
  const surname = (n) => n.split(' ').slice(-1)[0];
  function renderCharts() {
    // direct labels at the line ends (surname + latest value) instead of a legend; share axis starts at 0
    shareChart = shareChart || new TweenChart($('share-chart'), { yFmt: (v) => v + '%', endFmt: (v) => v.toFixed(1) + '%', readFmt: (v, k) => `${surname(k)} ${v.toFixed(1)}%`, xFmt: (t) => fmtHM.format(t), tipFmt: (t) => fmtHMS.format(t) });
    marginChart = marginChart || new TweenChart($('margin-chart'), { zero: true, yFmt: (v) => (v === 0 ? 'Tie' : Math.abs(v) + ''), endFmt: (v) => (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(1) + ' pts', xFmt: (t) => fmtHM.format(t), tipFmt: (t) => fmtHMS.format(t) });
    const hist = (state.history || []).filter((p) => p.votes > 0);
    const m = state.mayor;
    const top = m && m.total ? m.candidates.slice(0, 2).map((c) => c.name) : [];
    // polls-reporting context for both charts, so a big early swing reads as early
    if (!hist.length || !top.length) {
      const msg = 'Fills in as the City reports results after 8 PM ET.';
      shareChart.empty(msg); marginChart.empty(msg);
      return;
    }
    const sample = DEMO ? ' Sample data.' : '';
    const share = (p, n) => (p.votes ? ((p.c[n] || 0) / p.votes) * 100 : 0);
    const series = top.map((n) => ({ key: n, color: hexFor(n), points: hist.map((p) => ({ t: p.t, v: share(p, n) })) }));
    const all = series.flatMap((x) => x.points.map((p) => p.v));
    const step = Math.max(...all) > 60 ? 20 : 10;
    const hi = Math.min(100, Math.ceil((Math.max(...all) + 4) / step) * step);
    shareChart.update({ series, y: [0, hi], yTicks: d3.range(0, hi + 0.01, step),
      label: `Vote share over time: ${top.map((n) => n + ' ' + pct(share(hist.at(-1), n))).join(', ')} as of the latest update.${sample}` });
    const marg = hist.map((p) => ({ t: p.t, v: share(p, top[0]) - share(p, top[1]) }));
    const maxAbs = Math.max(...marg.map((p) => Math.abs(p.v)));
    const lim = maxAbs <= 4 ? 4 : maxAbs <= 10 ? 10 : maxAbs <= 20 ? 20 : Math.ceil(maxAbs / 10) * 10;
    marginChart.update({ series: [{ key: 'lead', color: '#1b1a18', points: marg }], y: [-lim, lim], yTicks: [-lim, -lim / 2, 0, lim / 2, lim],
      bands: [{ text: surname(top[0]) + ' ahead', color: hexFor(top[0]) }, { text: surname(top[1]) + ' ahead', color: hexFor(top[1]) }],
      label: `Lead over time: ${top[0]} ahead of ${top[1]} by ${Math.abs(marg.at(-1).v).toFixed(1)} points.${sample}` });
  }

  // ---------- candidate list (keyed: rows reorder with FLIP, numbers roll, bars spring) ----------
  function candNode(c) {
    const li = document.createElement('li');
    li.className = 'cand'; li.dataset.key = c.name;
    li.innerHTML = `<span class="who"><i></i><span class="nm-link"><span class="nm"></span></span><span class="ext" hidden></span></span><span class="p">${NUM_HTML}</span><span class="n">${NUM_HTML}</span><span class="bar" aria-hidden="true"><i></i></span>`;
    li.querySelector('.who i').style.background = colorFor(c.name);
    li.querySelector('.bar i').style.background = colorFor(c.name);
    li.querySelector('.nm').textContent = c.name;
    paintIdentity(li.querySelector('.who'), c.name);
    const mark = statusTip(c.name, 'cand');
    if (mark) li.querySelector('.who').append(mark);
    return li;
  }
  const candNodes = new Map();
  // Update a candidate's numbers in place; returns its (possibly new) row.
  function candRow(c, max) {
    let li = candNodes.get(c.name);
    const fresh = !li;
    if (fresh) { li = candNode(c); candNodes.set(c.name, li); }
    const opt = { instant: fresh };
    setNum(li.querySelector('.p .tw'), c.pct, (v) => v.toFixed(1) + '%', opt);
    setNum(li.querySelector('.n .tw'), c.votes, (v) => fmtInt.format(Math.round(v)), opt);
    setBar(li.querySelector('.bar i'), max ? c.votes / max : 0, opt);
    return li;
  }
  function placeRows(ol, nodes) {
    nodes.forEach((li, i) => { if (ol.children[i] !== li) ol.insertBefore(li, ol.children[i] || null); });
    while (ol.children.length > nodes.length) ol.lastElementChild.remove();
  }
  // Always by votes, most first; ties (including the all-zero start) fall back to name so the order is stable.
  const byVotes = (a, b) => b.votes - a.votes || a.name.localeCompare(b.name);
  function renderCandidates() {
    const m = state.mayor;
    if (!m) { $('cand-list').replaceChildren(h('li', 'muted', 'Candidate list loads from the City feed.')); return; }
    $('cand-list').querySelectorAll('li.muted').forEach((x) => x.remove());
    const list = [...m.candidates].sort(byVotes);
    const max = list[0] ? list[0].votes : 0;
    const nodes = list.map((c) => candRow(c, max));
    // One FLIP across both lists, so a name crossing into or out of the pinned top 3 slides instead of popping.
    const top = $('cand-top'), rest = $('cand-list');
    reorder(document.querySelector('.cand-card'), () => { placeRows(top, nodes.slice(0, 3)); placeRows(rest, nodes.slice(3)); syncCandFade(); },
      { items: () => [...top.children, ...rest.children] });
    setFavicon(m.total && list[0] && !(list[1] && list[1].votes === list[0].votes) ? hexFor(list[0].name) : '#8f8a80');
    $('cands-count').textContent = `${list.length} candidates`;
  }

  // ---------- ward table ----------
  // Hierarchy (Jakub: identifying content leads, metadata trails; Fluid Functionalism: 3 weights, 2 text colours):
  //   ward name
  //   leader (colour dot) with the leader's share and votes, right-aligned in number columns
  //   the gap in plain words: "Leads by 120 votes (0.6 pts)" (+ a quiet amber "Close", or "Tied")
  //   runner-up with its own share and votes, in the same number columns
  //   polls reporting
  // The same row markup is a 5-column grid table on desktop and a stacked card on phones (subgrid columns).
  // Feed strings are set with textContent only.
  const rowNodes = new Map(); // `${race}:${num}` -> tr
  let rowsRace = null;
  function rowNode(w) {
    const tr = document.createElement('tr');
    tr.dataset.ward = w.num;
    tr.setAttribute('role', 'row');
    tr.innerHTML = `
      <th scope="row" role="rowheader" class="c-ward"><button type="button" class="row-btn"><span class="wn"></span><span class="wname"></span></button></th>
      <td role="cell" class="c-lead"><span class="has who"><i></i><span class="nm"></span></span><span class="none muted"></span></td>
      <td role="cell" class="c-pct"><span class="has"><span class="lp">${NUM_HTML}</span><span class="pv"><span class="lvv">${NUM_HTML}</span> votes</span></span><span class="none muted">No votes yet</span></td>
      <td role="cell" class="c-margin"><span class="has"><span class="mg">Leads by <span class="mv">${NUM_HTML}</span> <span class="mvu">votes</span> (<span class="mp">${NUM_HTML}</span> pts)</span><span class="flag tied" hidden>Tied</span><span class="flag close" hidden>Close</span></span></td>
      <td role="cell" class="c-rep"><span class="bar" aria-hidden="true"><i></i></span><span class="rt"><span class="pr">${NUM_HTML}</span> of <span class="pt"></span><span class="unit"> polls</span></span></td>
      <td role="cell" class="c-more"><span class="has rr"><span class="rnm"><span class="rlab">Runner-up<span class="pz">:</span></span> <span class="rn"></span><span class="pz">,</span></span> <span class="rp">${NUM_HTML}</span><span class="pz">,</span> <span class="rv"><span class="rvn">${NUM_HTML}</span> votes</span></span><span class="none"></span></td>`;
    tr.querySelector('.wn').textContent = w.num;
    tr.querySelector('.wname').textContent = w.name;
    tr.querySelector('.row-btn').setAttribute('aria-label', `Show ward ${w.num} ${w.name} on the map`);
    tr.querySelector('.pt').textContent = fmtInt.format((race === 'council' ? w.council : w.mayor).polls);
    return tr;
  }
  function fillRow(tr, w, r, col, instant) {
    const has = r.total > 0;
    const lead = has ? r.candidates[0] : null, run = has ? r.candidates[1] : null;
    const opt = { instant };
    tr.querySelectorAll('.has').forEach((el) => (el.hidden = !has));
    tr.querySelectorAll('.none').forEach((el) => (el.hidden = has));
    // zero state keeps the same lines as a reporting card: status, then the candidate count where the runner-up goes
    tr.querySelector('.c-lead .none').textContent = has ? '' : 'No results yet';
    tr.querySelector('.c-more .none').textContent = has ? '' : `${r.candidates.length} candidates`;
    if (!has) { tr.querySelector('.c-more').title = ''; tr.querySelector('.c-margin').title = ''; }
    const int = (v) => fmtInt.format(Math.round(v)), p1 = (v) => v.toFixed(1) + '%';
    if (has) {
      tr.querySelector('.who i').style.background = col(lead.name);
      setText(tr.querySelector('.nm'), lead.name, opt);
      setNum(tr.querySelector('.lp .tw'), lead.pct, p1, opt);
      setNum(tr.querySelector('.lvv .tw'), lead.votes, int, opt);
      const close = r.marginPts != null && r.marginPts < 5 && r.pollsReceived > 0;
      tr.querySelector('.mg').hidden = !!r.tie || !run;
      tr.querySelector('.tied').hidden = !r.tie;
      tr.querySelector('.close').hidden = r.tie || !close || !run;
      setNum(tr.querySelector('.mv .tw'), r.marginVotes || 0, int, opt);
      tr.querySelector('.mvu').textContent = r.marginVotes === 1 ? 'vote' : 'votes';
      setNum(tr.querySelector('.mp .tw'), r.marginPts || 0, (v) => v.toFixed(1), opt);
      tr.querySelector('.c-margin').title = r.tie ? 'Tied' : run ? gapText(r) : '';
      const more = tr.querySelector('.c-more .has');
      more.hidden = !run;
      if (run) {
        setText(tr.querySelector('.rn'), run.name, opt);
        setNum(tr.querySelector('.rp .tw'), run.pct, p1, opt);
        setNum(tr.querySelector('.rvn .tw'), run.votes, int, opt);
      }
      // the line can truncate; the full text stays one hover away
      tr.querySelector('.c-more').title = run ? `Runner-up: ${run.name}, ${p1(run.pct)}, ${int(run.votes)} votes` : '';
    }
    setNum(tr.querySelector('.pr .tw'), r.pollsReceived, int, opt);
    setBar(tr.querySelector('.c-rep .bar i'), r.polls ? r.pollsReceived / r.polls : 0, opt);
  }
  // now = true for things the user just did (sort, filter, race switch): move immediately.
  // Feed updates (now = false) coalesce: if rows are still gliding, the new order waits for them to land.
  function renderTable(now = false) {
    const q = $('filter').value.trim().toLowerCase();
    const sort = $('sort').value;
    const rows = (state.wards || []).map((w) => ({ w, r: race === 'council' ? w.council : w.mayor })).filter(({ r }) => r);
    const filtered = rows.filter(({ w, r }) => !q || `${w.num} ${w.name} ${r.candidates.map((c) => c.name).join(' ')}`.toLowerCase().includes(q));
    const marginKey = (r) => (r.total ? r.marginPts : Infinity);
    filtered.sort((a, b) => sort === 'margin' ? marginKey(a.r) - marginKey(b.r) || a.w.num - b.w.num
      : sort === 'reporting' ? (a.r.pollsReceived / a.r.polls) - (b.r.pollsReceived / b.r.polls) || a.w.num - b.w.num
      : a.w.num - b.w.num);
    const col = race === 'council' ? councilColor : colorFor;
    const tbody = $('ward-rows');
    if (rowsRace !== race) { tbody.innerHTML = ''; rowNodes.clear(); rowsRace = race; now = true; }
    // Numbers update in place right away; only the order change goes through reorder().
    const nodes = filtered.map(({ w, r }) => {
      const key = race + ':' + w.num;
      let tr = rowNodes.get(key);
      const fresh = !tr;
      if (fresh) { tr = rowNode(w); rowNodes.set(key, tr); }
      fillRow(tr, w, r, col, fresh);
      return tr;
    });
    reorder(tbody, () => {
      nodes.forEach((tr, i) => { if (tbody.children[i] !== tr) tbody.insertBefore(tr, tbody.children[i] || null); });
      const keep = new Set(nodes);
      [...tbody.children].forEach((tr) => { if (!keep.has(tr)) tr.remove(); });
    }, { now, onSettle: () => rowHover && rowHover.refresh() });
    $('table-empty').hidden = !q || filtered.length > 0;
    $('table-caption').textContent = `${race === 'council' ? 'Councillor' : 'Mayoral'} results by ward${DEMO ? ' (sample data)' : ''}`;
    if (rowHover) requestAnimationFrame(rowHover.refresh);
  }

  // Table rows are click targets (show the ward on the map), so they share one gliding hover highlight.
  const rowHover = Fluid.fluidHover($('table-wrap'), {
    items: () => [...$('ward-rows').children],
    axis: 'y', className: 'fluid-hl-row',
  });
  // One handler for the whole card/row on every input type (the hover glide no longer activates, so a click cannot fire twice).
  $('ward-rows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-ward]'); if (!tr || e.target.closest('a, input, select, summary')) return; showWard(tr.dataset.ward, e); });
  // A list card or row selects its ward on the map, opens the panel, then brings map + panel into view.
  // List taps always open (never toggle closed), and a repeat within 400 ms is ignored (guards touch/click double fire).
  let lastShow = { num: null, t: 0 }, scrollJob = 0;
  function showWard(num, ev) {
    if (!wardLayer) return;
    const now = performance.now();
    if (String(lastShow.num) === String(num) && now - lastShow.t < 400) return;
    lastShow = { num, t: now };
    const btn = ev && ev.target && ev.target.closest && ev.target.closest('.row-btn');
    if (selected == null || String(selected) !== String(num)) selectWard(num, { from: btn || null, focus: !!(ev && ev.detail === 0) });
    else if (ev && ev.detail === 0) panelTitle.focus({ preventScroll: true });
    revealMapAndPanel();
  }
  function topInset() {
    const banner = document.querySelector('.sample-banner:not([hidden])');
    if (!banner || getComputedStyle(banner).position !== 'sticky') return 0;
    return Math.max(0, banner.getBoundingClientRect().bottom);
  }
  // Where to scroll so the map card and the fully opened panel sit below the sticky banner.
  // If both don't fit (small phones), keep the whole panel and as much map as fits, and pan the ward into the visible strip.
  function revealPlan() {
    const card = document.querySelector('.map-card'), mapEl = $('map'), body = panel.querySelector('.wp-body');
    const vh = (window.visualViewport && visualViewport.height) || innerHeight;
    const inset = topInset(), gap = 8, avail = vh - inset - gap * 2;
    const y = scrollY, cardTop = card.getBoundingClientRect().top + y, mapTop = mapEl.getBoundingClientRect().top + y;
    const pTop = panel.getBoundingClientRect().top + y;
    const pBottom = pTop + (body ? body.offsetHeight + parseFloat(getComputedStyle(body).marginTop || 0) : 0);
    let top, partial = false;
    if (pBottom - cardTop <= avail) top = cardTop - inset - gap;
    else if (pBottom - mapTop <= avail) top = pBottom - vh + gap;
    else { top = pBottom - vh + gap; partial = true; }
    top = Math.max(0, Math.min(top, document.documentElement.scrollHeight - vh));
    return { top: Math.round(top), partial, inset, mapTop };
  }
  function panWardIntoStrip(plan) {
    const l = layerFor(selected); if (!l) return;
    const size = map.getSize();
    const y0 = Math.max(0, plan.inset + 8 - (plan.mapTop - plan.top)); // first map pixel not under the banner
    const want = L.point(size.x / 2, (y0 + size.y) / 2);
    const at = map.latLngToContainerPoint(l.getBounds().getCenter());
    const d = at.subtract(want);
    if (Math.abs(d.x) > 4 || Math.abs(d.y) > 4) map.panBy(d, { animate: !reduceMotion.matches });
  }
  function revealMapAndPanel() {
    const job = ++scrollJob;
    let userMoved = false;
    const stop = () => { userMoved = true; };
    const opts = { passive: true, once: true };
    addEventListener('touchstart', stop, opts); addEventListener('wheel', stop, opts);
    requestAnimationFrame(() => {
      if (job !== scrollJob) return;
      const plan = revealPlan();
      const behavior = reduceMotion.matches ? 'auto' : 'smooth';
      if (Math.abs(scrollY - plan.top) > 2) scrollTo({ top: plan.top, behavior });
      if (plan.partial) panWardIntoStrip(plan);
      // Settle check: if a re-render, toolbar resize or an interrupted smooth scroll left us short, correct once.
      let done = false;
      const settle = () => {
        if (done || job !== scrollJob) return; done = true;
        removeEventListener('scrollend', settle);
        removeEventListener('touchstart', stop); removeEventListener('wheel', stop);
        if (userMoved || selected == null) return;
        const p2 = revealPlan();
        if (Math.abs(scrollY - p2.top) > 16) scrollTo({ top: p2.top, behavior });
        if (p2.partial) panWardIntoStrip(p2);
      };
      if ('onscrollend' in window) addEventListener('scrollend', settle, { once: true });
      setTimeout(settle, reduceMotion.matches ? 120 : 900);
    });
  }

  const segGroup = document.querySelector('.segmented');
  const moveIndicator = Fluid.segmented(segGroup);
  Fluid.fluidHover(segGroup, { items: () => [...segGroup.querySelectorAll('.seg')], axis: 'x', className: 'fluid-hl-seg' });
  function setRace(r) {
    race = r;
    document.querySelectorAll('.seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.race === r)));
    moveIndicator();
    if (state) renderTable(true);
  }
  requestAnimationFrame(moveIndicator);
  addEventListener('resize', () => requestAnimationFrame(moveIndicator));
  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setRace(b.dataset.race)));
  $('sort').addEventListener('change', () => state && renderTable(true));
  $('filter').addEventListener('input', () => state && renderTable(true));

  // ---------- notifications (Sonner, mounted by /vendor/sonner/toaster.js) ----------
  // Calls made before the module loads are queued and drained when it mounts.
  const notify = (o) => { const x = { sample: DEMO, ...o }; if (window.notify) window.notify(x); else (window.__notifyQ = window.__notifyQ || []).push(x); };
  const pollsLine = (r) => `${fmtInt.format(r.pollsReceived)} of ${fmtInt.format(r.polls)} polls reporting.`;
  const short = (n) => surname(n);
  // One update can change many things; it becomes at most 3 toasts, and all ward changes share one.
  function announceChanges() {
    if (!prev || !prev.mayor || !state.mayor) return;
    const out = [];
    const pm = prev.mayor, m = state.mayor;
    const city = 'Mayor, city-wide';
    if (!pm.total && m.total) out.push({ context: city, title: 'First results are in', description: `${m.candidates.slice(0, 2).map((c) => `${short(c.name)} ${pct(c.pct)}`).join(', ')}. ${pollsLine(m)}` });
    else if (pm.leader && m.leader && pm.leader !== m.leader && !m.tie) out.push({ context: city, title: `${m.leader} now leads for Mayor`, description: `Ahead of ${short(m.candidates[1].name)} by ${gapText(m).replace(/^Leads by /, '')}. ${pollsLine(m)}` });
    if (m.polls && m.pollsReceived >= m.polls && pm.pollsReceived < pm.polls) out.push({ context: city, title: 'All polls have reported', description: `${short(m.leader)} is ahead with ${pct(m.candidates[0].pct)}. Unofficial until the City Clerk certifies.` });
    const pw = new Map(prev.wards.map((w) => [w.num, w]));
    const changes = [];
    for (const w of state.wards) {
      const o = pw.get(w.num); if (!o) continue;
      for (const [k, office] of [['mayor', 'Mayor'], ['council', 'Councillor']]) {
        const a1 = o[k], b1 = w[k];
        if (a1 && b1 && a1.leader && b1.leader && a1.leader !== b1.leader && !b1.tie) changes.push({ w, r: b1, office, brief: `Ward ${w.num} ${short(b1.leader)}${office === 'Councillor' ? ' (Councillor)' : ''}` });
      }
    }
    if (changes.length === 1) { const c = changes[0]; out.push({ context: `Ward ${c.w.num} ${c.w.name}`, title: `${c.r.leader} now leads for ${c.office}`, description: gapText(c.r) + '.' }); }
    else if (changes.length > 1) {
      const wards = new Set(changes.map((c) => c.w.num)).size;
      const shown = changes.slice(0, 3).map((c) => c.brief), more = changes.length - shown.length;
      const list = more > 0 ? `${shown.join(', ')} and ${more} more.` : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}.`;
      out.push({ context: 'Ward leaders', title: `New leaders in ${wards} ${wards === 1 ? 'ward' : 'wards'}`, description: list });
    }
    out.slice(0, 3).forEach((t) => notify(t));
  }
  // Feed connection: one toast that updates in place (same id) from "lost" to "restored".
  let connLost = false;
  function setConn(ok, title) {
    if (!ok && !connLost) { connLost = true; notify({ id: 'conn', sample: false, context: 'Results feed', tone: 'warn', duration: Infinity, title, description: 'Showing the last numbers received. Retrying automatically.' }); }
    else if (ok && connLost) { connLost = false; notify({ id: 'conn', sample: false, context: 'Results feed', tone: 'ok', duration: 4000, title: 'Connection restored', description: 'Results are updating again.' }); }
  }

  // ---------- go ----------
  function clientWait() {
    const next = state && state.nextCheckAt;
    if (!lastLoadOk || !next) return SIM ? 4000 : CLIENT_CAP_MS;
    const aligned = next + CLIENT_LAG_MS - Date.now();
    if (SIM) return Math.min(CLIENT_CAP_MS, Math.max(500, aligned));
    if (aligned > CLIENT_CAP_MS) return CLIENT_CAP_MS;
    return Math.max(800, aligned);
  }
  let clientTimer = 0;
  function armClient() {
    clearTimeout(clientTimer);
    if (document.hidden) return;
    clientTimer = setTimeout(() => { load().finally(armClient); }, clientWait());
  }
  initMap().catch(() => { $('map').replaceChildren(h('p', 'hint map-error', "Map couldn't load. The ward table below has the same results.")); });
  load().finally(armClient);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(clientTimer);
    if (document.hidden) return;
    load().finally(armClient);
  });
})();

// Candidate list: the top 3 stay pinned, everyone else scrolls inside the card. A soft fade marks the bottom edge
// only while more names are below (a class toggle on a mask, so nothing moves).
function syncCandFade() {
  const box = document.getElementById('cand-scroll');
  if (!box) return;
  box.classList.toggle('more-below', box.scrollHeight - box.clientHeight - box.scrollTop > 2);
}
(function () {
  const box = document.getElementById('cand-scroll');
  if (!box) return;
  box.addEventListener('scroll', syncCandFade, { passive: true });
  new ResizeObserver(syncCandFade).observe(box);
})();

// The sticky SAMPLE banner's height, so the map card can fill the screen under it (--banner-h in styles.css).
(function () {
  const banner = document.getElementById('sample-banner');
  if (!banner) return;
  const set = () => document.documentElement.style.setProperty('--banner-h', (banner.hidden ? 0 : banner.offsetHeight) + 'px');
  new ResizeObserver(set).observe(banner);
  new MutationObserver(set).observe(banner, { attributes: true, attributeFilter: ['hidden'] });
  set();
})();

// Tab icon in the city-wide leader's colour (grey before results or on a tie). Only touches the DOM when the colour changes.
var faviconColor = '';
function setFavicon(color) {
  if (!color || color === faviconColor) return;
  faviconColor = color;
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='" + color + "'/></svg>";
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
