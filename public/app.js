'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1' || params.get('demo') === 'live';
  const SIM = DEMO && (params.get('demo') === 'live' || params.get('live') === '1') && !params.has('p');
  const API = '/api/state' + (DEMO ? '?demo=1' + (SIM ? '&live=1' : '') + (params.has('p') ? '&p=' + encodeURIComponent(params.get('p')) : '') : '');
  // The browser asks our server; the server asks the City at most once a minute.
  // Simulated-live sample mode steps every 4 s so the motion can be watched.
  const REFRESH_MS = SIM ? 4000 : 15000;
  const { setNum, setBar, setText, reorder, NUM_HTML } = window.Fluid;
  const TZ = 'America/Toronto';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat('en-CA');
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtHM = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
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
    try {
      const res = await fetch(API, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const next = await res.json();
      if (DEMO && !next.sample) throw new Error('Expected sample data in demo mode');
      if (!DEMO && next.sample) throw new Error('Refusing sample data in live mode');
      prev = state; state = next; lastFetchOk = Date.now();
      render();
      setConn(!next.error, "Can't reach the City's results feed");
    } catch (e) {
      setConn(false, 'Lost connection to the tracker');
      showError(`Can't reach the tracker server (${e.message}). ${state ? 'Showing the last numbers received.' : ''} Retrying every ${REFRESH_MS / 1000} seconds.`);
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

    if (s.error) showError(`Couldn't reach the City's results feed at ${et(s.error.at)} (${s.error.message}). ${s.lastCheckAt ? 'Showing data last received at ' + et(s.lastCheckAt) + '.' : ''} Retrying automatically every minute.`);
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
      zero.innerHTML = before8
        ? '<strong>Polls close at 8 PM ET.</strong> The City posts its first results after that. This page checks the official feed every minute and fills in by itself, so you can leave it open.'
        : '<strong>Polls closed at 8 PM ET.</strong> No results in the City\'s feed yet. This page checks every minute and will update by itself.';
    } else {
      zero.hidden = true;
      leaders.hidden = false;
      m.candidates.slice(0, 2).forEach((c, i) => renderLeader(i, c, m));
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
  function renderLeader(i, c, m) {
    let el = $('leaders').children[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'leader';
      // one row of the leaders grid: name (+ tag right after it), share, votes. Columns come from the parent (subgrid).
      el.innerHTML = `<span class="leader-name"><i></i><span class="nm"></span><span class="leader-tag t-wide"></span></span><span class="leader-pct">${NUM_HTML}</span><span class="leader-votes">${NUM_HTML}<span class="unit"> votes</span><span class="leader-tag t-narrow"></span></span>`;
      // the tag sits right after the name on wide screens and after the vote count on phones (CSS picks one)
      $('leaders').appendChild(el);
    }
    setText(el.querySelector('.leader-name .nm'), c.name);
    el.querySelector('.leader-name .nm').title = c.name;
    el.querySelector('.leader-name i').style.background = colorFor(c.name);
    el.querySelector('.leader-pct').style.color = INK[c.name] || 'var(--ink)';
    setNum(el.querySelector('.leader-pct .tw'), c.pct, (v) => v.toFixed(1) + '%');
    setNum(el.querySelector('.leader-votes .tw'), c.votes, (v) => fmtInt.format(Math.round(v)));
    const txt = i === 0 ? (m.tie ? 'Tied' : 'Leading') : '';
    el.querySelectorAll('.leader-tag').forEach((tag) => { tag.hidden = !txt; setText(tag, txt); });
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
    const items = [...names].map((n) => li(sw(colorFor(n)), n));
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
    if (w.council && w.council.leader && w.council.marginVotes != null) box.append(h('div', 'sub tip-council', `Council: ${w.council.leader} ${w.council.tie ? 'tied' : gapText(w.council).replace(/^L/, 'l')}`));
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
  function showTip(num, pt) {
    const w = wardInfo(num); if (!w || !tipEl) return;
    if (tipNum !== num) { tipEl.replaceChildren(wardDetails(w)); tipNum = num; }
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
    if (tipNum != null && tipEl && !tipEl.hidden) { const n = tipNum; tipNum = null; showTip(n, tipPt); }
  }

  // ---------- charts (D3 scales + Motion springs, see charts.js) ----------
  let shareChart, marginChart;
  const surname = (n) => n.split(' ').slice(-1)[0];
  function renderCharts() {
    // direct labels at the line ends (surname + latest value) instead of a legend; share axis starts at 0
    shareChart = shareChart || new TweenChart($('share-chart'), { R: 92, yFmt: (v) => v + '%', endFmt: (v, k) => `${surname(k)} ${v.toFixed(1)}%`, xFmt: (t) => fmtHM.format(t) });
    marginChart = marginChart || new TweenChart($('margin-chart'), { R: 58, zero: true, yFmt: (v) => (v === 0 ? 'Tie' : Math.abs(v) + ''), endFmt: (v) => (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(1) + ' pts', xFmt: (t) => fmtHM.format(t) });
    const hist = (state.history || []).filter((p) => p.votes > 0);
    const m = state.mayor;
    const top = m && m.total ? m.candidates.slice(0, 2).map((c) => c.name) : [];
    // polls-reporting context for both charts, so a big early swing reads as early
    const ctx = m && m.total ? `As of ${fmtInt.format(m.pollsReceived)} of ${fmtInt.format(m.polls)} polls reporting.${DEMO ? ' Sample data.' : ''}` : '';
    $('share-note').textContent = ctx ? `Share of votes counted so far. ${ctx}` : 'Share of votes counted so far.';
    $('margin-note').textContent = ctx ? `Gap between the top two, in percentage points. Not a projection. ${ctx}` : 'Gap between the top two, in percentage points. Not a projection.';
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
    li.innerHTML = `<span class="who"><i></i><span class="nm"></span></span><span class="p">${NUM_HTML}</span><span class="n">${NUM_HTML}</span><span class="bar" aria-hidden="true"><i></i></span>`;
    li.querySelector('.who i').style.background = colorFor(c.name);
    li.querySelector('.bar i').style.background = colorFor(c.name);
    li.querySelector('.nm').textContent = c.name;
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
    $('table-empty').hidden = filtered.length > 0;
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
    if (m.polls && m.pollsReceived >= m.polls && pm.pollsReceived < pm.polls) out.push({ context: city, title: 'All polls have reported', description: `${short(m.leader)} finishes ahead with ${pct(m.candidates[0].pct)}. Unofficial until the City certifies.` });
    const pw = new Map(prev.wards.map((w) => [w.num, w]));
    const changes = [];
    for (const w of state.wards) {
      const o = pw.get(w.num); if (!o) continue;
      for (const [k, office] of [['mayor', 'Mayor'], ['council', 'Council']]) {
        const a1 = o[k], b1 = w[k];
        if (a1 && b1 && a1.leader && b1.leader && a1.leader !== b1.leader && !b1.tie) changes.push({ w, r: b1, office, brief: `Ward ${w.num} ${short(b1.leader)}${office === 'Council' ? ' (Council)' : ''}` });
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
  initMap().catch(() => { $('map').replaceChildren(h('p', 'hint map-error', "Map couldn't load. The ward table below has the same results.")); });
  load();
  let iv = setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { clearInterval(iv); if (!document.hidden) { load(); iv = setInterval(load, REFRESH_MS); } });
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
