'use strict';
// Animated line chart: D3 for scales, line shapes and tick values; Motion springs drive the tween.
// Each update interpolates from whatever is on screen (so an update mid-flight never jumps):
//   - axes rescale smoothly (both domains interpolate), ticks fade in/out at their moving positions
//   - existing points glide to their new positions; new points grow out of the previous endpoint
//   - end-of-line value labels roll to their new numbers
// Reduced motion: every update lands immediately.
function valueAt(pts, t) {
  if (!pts.length) return 0;
  if (t <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (i < pts.length && pts[i].t < t) i++;
  const a = pts[i - 1], b = pts[i] || a;
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * u;
}
// The top label sits above its dot and the bottom label sits below its own,
// so two close lines don't drop both captions into the gap between them.
function placeEndLabels(ends, top, bottom) {
  const GAP = 18;
  const PAD = 16;
  ends.sort((a, b) => a.yy - b.yy);
  if (!ends.length) return;
  if (ends.length === 1) {
    ends[0].ly = ends[0].yy - PAD < top + 8 ? ends[0].yy + PAD : ends[0].yy - PAD;
    return;
  }
  ends.forEach((e, i) => { e.ly = i === ends.length - 1 ? e.yy + PAD : e.yy - PAD; });
  if (ends[0].ly < top + 8) ends[0].ly = top + 8;
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].ly - ends[i - 1].ly < GAP) ends[i].ly = ends[i - 1].ly + GAP;
  }
  const overflow = ends[ends.length - 1].ly - (bottom - 4);
  if (overflow > 0) {
    for (const e of ends) e.ly -= overflow;
    if (ends[0].ly < top + 8) ends[0].ly = top + 8;
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].ly - ends[i - 1].ly < GAP) ends[i].ly = ends[i - 1].ly + GAP;
    }
  }
}
// Sit the dot on the drawn curve, which is monotone in x.
function pointAtX(path, x) {
  const len = path.getTotalLength();
  if (!len) return null;
  let lo = 0, hi = len;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (path.getPointAtLength(mid).x < x) lo = mid;
    else hi = mid;
  }
  return path.getPointAtLength((lo + hi) / 2);
}
window.TweenChart = class TweenChart {
  constructor(el, o) {
    this.el = el;
    this.o = Object.assign({ W: 320, H: 158, L: 30, R: 12, T: 10, B: 22, yFmt: (v) => String(v), endFmt: (v) => v.toFixed(1), xFmt: (t) => String(t) }, o);
    const ns = 'http://www.w3.org/2000/svg';
    el.innerHTML = '';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('role', 'img');
    el.appendChild(svg);
    this.svgEl = svg;
    this.fit();
    // Draw at the card's real width (1 unit = 1 px, so type and strokes keep their size) and redraw when it changes.
    new ResizeObserver(() => { if (this.fit() && this.cur) { this.draw(this.cur, 1); if (this.bands) this.drawBands(this.bands); } }).observe(el);
    this.msg = document.createElement('div');
    this.msg.className = 'chart-empty';
    this.msg.hidden = true;
    el.appendChild(this.msg);
    this.svg = d3.select(svg);
    this.gY = this.svg.append('g').attr('class', 'axis y-axis');
    this.gX = this.svg.append('g').attr('class', 'axis x-axis');
    this.gBands = this.svg.append('g').attr('class', 'axis bands');
    this.zero = this.o.zero ? this.svg.append('line').attr('class', 'zero-line') : null;
    this.gLines = this.svg.append('g');
    this.gDots = this.svg.append('g');
    this.gScrub = this.svg.append('g').attr('class', 'scrub').style('display', 'none').style('pointer-events', 'none');
    this.scrubLine = this.gScrub.append('line').attr('class', 'scrub-line');
    this.gScrubDots = this.gScrub.append('g');
    this.gEnd = this.svg.append('g').attr('class', 'end-labels');
    this.cur = null;     // what is on screen right now
    this.anim = null;
    this.scrub = { on: false, x: null, anim: null, stick: false };
    this.yTicks = new Map(); // value -> {el, o, from, to}
    this.xTicks = new Map();
    this.readout = document.createElement('div');
    this.readout.className = 'chart-readout';
    this.readout.hidden = true;
    this.readoutTime = document.createElement('div');
    this.readoutTime.className = 'chart-readout-time';
    this.readoutRows = document.createElement('div');
    this.readout.append(this.readoutTime, this.readoutRows);
    el.appendChild(this.readout);
    this.bindPointer();
  }

  // data: { series: [{ key, color, points: [{t, v}] }], y: [min, max], yTicks: [..], label, bands: [top, bottom] }
  update(data) {
    const { animate } = window.Motion;
    this.msg.hidden = true; this.svg.style('display', null);
    this.svg.attr('aria-label', data.label);
    if (data.bands) this.drawBands(data.bands);
    const target = { x: [data.series[0].points[0].t, data.series[0].points.at(-1).t], y: data.y.slice(), series: new Map() };
    for (const s of data.series) target.series.set(s.key, { color: s.color, pts: s.points.map((p) => ({ ...p })), o: 1 });
    // tick targets
    this.setTickTargets(this.yTicks, data.yTicks);
    const xt = d3.scaleTime().domain(target.x.map((t) => new Date(t))).ticks(3).map((d) => +d).filter((t) => { const span = target.x[1] - target.x[0]; return t - target.x[0] > span * 0.16 && target.x[1] - t > span * 0.2; });
    // one label per distinct clock time: a short sample run can make every tick read "6:45 PM"
    const seen = new Set([this.o.xFmt(target.x[0]), this.o.xFmt(target.x[1])]);
    const mid = xt.filter((t) => { const l = this.o.xFmt(t); if (seen.has(l)) return false; seen.add(l); return true; });
    const ends = this.o.xFmt(target.x[0]) === this.o.xFmt(target.x[1]) ? [target.x[1]] : [target.x[0], target.x[1]];
    this.setTickTargets(this.xTicks, [ends[0], ...mid, ...ends.slice(1)].filter((v, i, a) => a.indexOf(v) === i), true);

    const from = this.cur ? this.snapshot() : null;
    if (!from) { // first draw: hold the final scales and reveal lines left to right
      this.cur = this.interp(target, target, 1);
      this.draw(this.cur, 1);
      this.reveal();
      this.settleTicks();
      return;
    }
    // Pair up points: existing indices glide, new ones start at the previous endpoint.
    const start = { x: from.x, y: from.y, series: new Map() };
    for (const [k, ts] of target.series) {
      const fs = from.series.get(k);
      if (!fs || !fs.pts.length) { start.series.set(k, { color: ts.color, pts: ts.pts.map((p) => ({ ...p })), o: 0 }); continue; }
      const last = fs.pts.at(-1);
      start.series.set(k, { color: ts.color, o: fs.o, pts: ts.pts.map((p, i) => (i < fs.pts.length ? { ...fs.pts[i] } : { ...last })) });
    }
    for (const [k, fs] of from.series) if (!target.series.has(k)) { start.series.set(k, fs); target.series.set(k, { ...fs, o: 0 }); }

    if (this.anim) this.anim.stop();
    const go = (t) => { this.cur = this.interp(start, target, t); this.draw(this.cur, t); };
    if (Fluid.reduce.matches) { go(1); this.finish(target); return; }
    this.anim = animate(0, 1, { ...Fluid.tr('data'), onUpdate: go, onComplete: () => { go(1); this.finish(target); } });
  }

  finish(target) {
    for (const [k, s] of target.series) if (s.o === 0) target.series.delete(k);
    this.cur = this.interp(target, target, 1);
    this.draw(this.cur, 1);
    this.settleTicks();
    this.anim = null;
  }

  // Width follows the container; height follows the width within 160 to 220 px. Returns true when the size changed.
  fit() {
    const w = Math.round(this.el.clientWidth) || this.o.W;
    const h = Math.round(Math.min(220, Math.max(160, w * 0.38)));
    if (w === this.o.W && h === this.o.H && this.sized) return false;
    this.sized = true;
    this.o.W = w; this.o.H = h;
    this.svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.el.style.minHeight = h + 'px';
    return true;
  }

  snapshot() { return { x: this.cur.x.slice(), y: this.cur.y.slice(), series: new Map([...this.cur.series].map(([k, s]) => [k, { color: s.color, o: s.o, pts: s.pts.map((p) => ({ ...p })) }])) }; }

  interp(a, b, t) {
    const L = (p, q) => p + (q - p) * t;
    const out = { x: [L(a.x[0], b.x[0]), L(a.x[1], b.x[1])], y: [L(a.y[0], b.y[0]), L(a.y[1], b.y[1])], series: new Map() };
    for (const [k, bs] of b.series) {
      const as = a.series.get(k) || bs;
      out.series.set(k, { color: bs.color, o: L(as.o, bs.o), pts: bs.pts.map((p, i) => { const q = as.pts[i] || p; return { t: L(q.t, p.t), v: L(q.v, p.v) }; }) });
    }
    return out;
  }

  setTickTargets(map, values, isX) {
    const keep = new Set(values);
    for (const [v, tk] of map) { tk.from = tk.o; tk.to = keep.has(v) ? 1 : 0; }
    for (const v of values) if (!map.has(v)) map.set(v, { o: 0, from: 0, to: 1, el: null, isX });
  }
  settleTicks() {
    for (const map of [this.yTicks, this.xTicks]) for (const [v, tk] of map) {
      tk.o = tk.to; tk.from = tk.to;
      if (tk.to === 0) { if (tk.el) tk.el.remove(); map.delete(v); } else if (tk.el) tk.el.setAttribute('opacity', 1);
    }
  }

  draw(c, t) {
    const { W, H, L, R, T, B } = this.o;
    const x = d3.scaleLinear().domain(c.x[0] === c.x[1] ? [c.x[0] - 1, c.x[1] + 1] : c.x).range([L, W - R]);
    const y = d3.scaleLinear().domain(c.y).range([H - B, T]);
    // y ticks: gridline + label, positioned on the moving scale, fading by their own target
    for (const [v, tk] of this.yTicks) {
      if (!tk.el) {
        tk.el = this.gY.append('g').node();
        d3.select(tk.el).append('line').attr('class', 'grid-line').attr('x1', L).attr('x2', W - R);
        d3.select(tk.el).append('text').attr('x', L - 6).attr('text-anchor', 'end').attr('dy', '0.32em').text(this.o.yFmt(v));
      }
      tk.o = tk.from + (tk.to - tk.from) * t;
      const yy = y(v);
      tk.el.firstChild.setAttribute('x2', W - R);
      tk.el.setAttribute('transform', `translate(0,${yy.toFixed(2)})`);
      tk.el.setAttribute('opacity', (yy < T - 2 || yy > H - B + 2) ? 0 : tk.o.toFixed(3));
    }
    const xEntries = [...this.xTicks.entries()].sort((a, b) => a[0] - b[0]);
    let prevLabel = -1e9;
    for (const [v, tk] of xEntries) {
      if (!tk.el) {
        tk.el = this.gX.append('text').attr('y', H - 5).attr('text-anchor', 'middle').text(this.o.xFmt(v)).node();
      }
      tk.o = tk.from + (tk.to - tk.from) * t;
      const xx = x(v);
      const placed = Math.max(L + 14, Math.min(W - R - 14, xx));
      const room = placed - prevLabel >= 52;
      if (room) prevLabel = placed;
      tk.el.setAttribute('y', H - 5);
      tk.el.setAttribute('x', placed.toFixed(2));
      tk.el.setAttribute('opacity', room ? tk.o.toFixed(3) : 0);
    }
    if (this.zero) this.zero.attr('x1', L).attr('x2', W - R).attr('y1', y(0)).attr('y2', y(0));
    const line = d3.line().x((p) => x(p.t)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    const series = [...c.series].map(([key, s]) => ({ key, ...s }));
    this.gLines.selectAll('path.series').data(series, (d) => d.key).join('path').attr('class', 'series')
      .attr('stroke', (d) => d.color).attr('opacity', (d) => d.o).attr('d', (d) => line(d.pts));
    this.gDots.selectAll('circle').data(series, (d) => d.key).join('circle').attr('r', 3.2)
      .attr('fill', (d) => d.color).attr('opacity', (d) => d.o)
      .attr('cx', (d) => x(d.pts.at(-1).t)).attr('cy', (d) => y(d.pts.at(-1).v));
    // End labels face away from each other. Putting both in the gap stacks them on one spot.
    const ends = series.map((d) => ({ key: d.key, color: d.color, o: d.o, v: d.pts.at(-1).v, xx: x(d.pts.at(-1).t), yy: y(d.pts.at(-1).v) }));
    placeEndLabels(ends, T, H - B);
    this.gEnd.attr('opacity', this.scrub.on ? 0 : 1);
    this.gEnd.selectAll('text').data(ends, (d) => d.key).join('text').attr('text-anchor', 'end').attr('x', (d) => d.xx - 10).attr('dy', '0.32em')
      .attr('y', (d) => d.ly).attr('fill', (d) => d.color).attr('opacity', (d) => d.o).text((d) => this.o.endFmt(d.v, d.key));
    if (this.hit) {
      this.hit.attr('x', 0).attr('y', 0).attr('width', W).attr('height', H);
      this.hit.raise();
      this.gScrub.raise();
    }
    if (this.scrub.on) this.paintScrub();
  }

  // A full-size hit target, because an SVG only receives the pointer where something is painted.
  // The guide stays under the cursor. A spring here never catches a moving pointer.
  bindPointer() {
    const svg = this.svgEl;
    svg.tabIndex = 0;
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-roledescription', 'chart');
    this.hit = this.svg.append('rect').attr('class', 'chart-hit').attr('fill', 'transparent');
    const localX = (e) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return this.o.L;
      return ((e.clientX - r.left) / r.width) * this.o.W;
    };
    const slide = (e) => {
      if (e.pointerType === 'touch' && !this.scrub.touching) return;
      this.place(localX(e));
    };
    this.hit.on('pointerenter', slide);
    this.hit.on('pointerdown', (e) => { this.scrub.touching = true; this.scrub.stick = e.pointerType !== 'mouse'; slide(e); });
    this.hit.on('pointermove', slide);
    this.hit.on('pointerup', () => { this.scrub.touching = false; });
    this.hit.on('pointerleave', () => { this.scrub.touching = false; if (!this.scrub.stick) this.clearScrub(); });
    svg.addEventListener('focus', () => { if (this.cur) this.place(this.xScale(this.cur)(this.cur.x[1])); });
    svg.addEventListener('blur', () => this.clearScrub());
    svg.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', (e) => { if (!this.el.contains(e.target)) this.clearScrub(); });
  }

  xScale(c) {
    const { L, R, W } = this.o;
    return d3.scaleLinear().domain(c.x[0] === c.x[1] ? [c.x[0] - 1, c.x[1] + 1] : c.x).range([L, W - R]);
  }

  place(px) {
    if (!this.cur) return;
    const [a, b] = this.xScale(this.cur).range();
    this.scrub.on = true;
    this.scrub.x = Math.max(a, Math.min(b, px));
    this.paintScrub();
  }

  clearScrub() {
    this.scrub.on = false;
    this.scrub.stick = false;
    this.scrub.touching = false;
    this.scrub.x = null;
    this.gScrub.style('display', 'none');
    this.gEnd.attr('opacity', 1);
    this.readout.hidden = true;
  }

  paintScrub() {
    const c = this.cur;
    if (!c || this.scrub.x == null) return;
    const { H, T, B } = this.o;
    const x = this.xScale(c);
    const y = d3.scaleLinear().domain(c.y).range([H - B, T]);
    const px = Math.max(x.range()[0], Math.min(x.range()[1], this.scrub.x));
    const t = x.invert(px);
    this.gScrub.style('display', null);
    this.scrubLine.attr('x1', px).attr('x2', px).attr('y1', T).attr('y2', H - B);
    const rows = [...c.series].filter(([, s]) => s.o > 0.35).map(([key, s]) => {
      const v = valueAt(s.pts, t);
      const path = this.gLines.selectAll('path.series').filter((d) => d.key === key).node();
      const on = path && pointAtX(path, px);
      return { key, color: s.color, v, cy: on ? on.y : y(v) };
    });
    this.gScrubDots.selectAll('circle').data(rows, (d) => d.key).join('circle')
      .attr('r', 4).attr('fill', (d) => d.color).attr('stroke', '#fff').attr('stroke-width', 2)
      .attr('cx', px).attr('cy', (d) => d.cy);
    this.gEnd.attr('opacity', 0);
    this.readout.hidden = false;
    this.readoutTime.textContent = (this.o.tipFmt || this.o.xFmt)(t);
    const have = new Map([...this.readoutRows.children].map((el) => [el.dataset.key, el]));
    const keep = new Set();
    for (const row of rows) {
      keep.add(row.key);
      let el = have.get(row.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'chart-readout-row';
        el.dataset.key = row.key;
        const dot = document.createElement('i');
        const label = document.createElement('span');
        el.append(dot, label);
        this.readoutRows.append(el);
      }
      el.firstChild.style.background = row.color;
      el.lastChild.textContent = (this.o.readFmt || this.o.endFmt)(row.v, row.key);
    }
    for (const [key, el] of have) if (!keep.has(key)) el.remove();
    const box = this.readout.offsetWidth || 96;
    let left = px + 12;
    if (left + box > this.o.W - 4) left = Math.max(4, px - box - 12);
    this.readout.style.left = left + 'px';
  }

  onKey(e) {
    if (!this.cur || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    const c = this.cur;
    const x = this.xScale(c);
    const times = [...new Set([...c.series.values()].flatMap((s) => s.pts.map((p) => p.t)))].sort((a, b) => a - b);
    const curT = this.scrub.x == null ? c.x[1] : x.invert(this.scrub.x);
    let toT = curT;
    if (e.key === 'Home') toT = c.x[0];
    else if (e.key === 'End') toT = c.x[1];
    else if (e.key === 'ArrowRight') toT = times.find((tm) => tm > curT + 1) ?? c.x[1];
    else toT = [...times].reverse().find((tm) => tm < curT - 1) ?? c.x[0];
    this.place(x(toT));
  }

  drawBands(bands) {
    this.bands = bands;
    const [top, bottom] = bands;
    const { L, T, H, B } = this.o;
    this.gBands.selectAll('text').data([top, bottom]).join('text')
      .attr('x', L + 4).attr('text-anchor', 'start').attr('y', (d, i) => (i ? H - B - 5 : T + 11))
      .attr('fill', (d) => d.color).attr('class', 'band-label').text((d) => d.text);
  }

  // first appearance: lines draw on left to right (stroke-dashoffset), dots and labels fade in
  reveal() {
    if (Fluid.reduce.matches) return;
    const { animate } = window.Motion;
    this.gLines.selectAll('path.series').each(function () {
      const len = this.getTotalLength();
      this.style.strokeDasharray = `${len} ${len}`;
      animate(this, { strokeDashoffset: [len, 0] }, Fluid.tr('data')).then(() => { this.style.strokeDasharray = ''; this.style.strokeDashoffset = ''; });
    });
    for (const g of [this.gDots.node(), this.gEnd.node()]) animate(g, { opacity: [0, 1] }, Fluid.tr('slow'));
  }

  empty(msg) {
    if (this.anim) this.anim.stop();
    this.clearScrub();
    this.cur = null; this.anim = null; this.bands = null;
    for (const m of [this.yTicks, this.xTicks]) { for (const tk of m.values()) if (tk.el) tk.el.remove(); m.clear(); }
    this.gLines.selectAll('*').remove(); this.gDots.selectAll('*').remove(); this.gEnd.selectAll('*').remove(); this.gBands.selectAll('*').remove();
    this.svg.style('display', 'none');
    this.msg.textContent = msg; this.msg.hidden = false;
  }
};
