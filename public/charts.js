'use strict';
// Animated line chart: D3 for scales, line shapes and tick values; Motion springs drive the tween.
// Each update interpolates from whatever is on screen (so an update mid-flight never jumps):
//   - axes rescale smoothly (both domains interpolate), ticks fade in/out at their moving positions
//   - existing points glide to their new positions; new points grow out of the previous endpoint
//   - end-of-line value labels roll to their new numbers
// Reduced motion: every update lands immediately.
window.TweenChart = class TweenChart {
  constructor(el, o) {
    this.el = el;
    this.o = Object.assign({ W: 320, H: 158, L: 34, R: 50, T: 10, B: 22, yFmt: (v) => String(v), endFmt: (v) => v.toFixed(1), xFmt: (t) => String(t) }, o);
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
    this.gEnd = this.svg.append('g').attr('class', 'end-labels');
    this.cur = null;     // what is on screen right now
    this.anim = null;
    this.yTicks = new Map(); // value -> {el, o, from, to}
    this.xTicks = new Map();
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
    for (const [v, tk] of this.xTicks) {
      if (!tk.el) {
        tk.el = this.gX.append('text').attr('y', H - 5).attr('text-anchor', 'middle').text(this.o.xFmt(v)).node();
      }
      tk.o = tk.from + (tk.to - tk.from) * t;
      const xx = x(v);
      tk.el.setAttribute('y', H - 5);
      tk.el.setAttribute('x', Math.max(L + 14, Math.min(W - R - 14, xx)).toFixed(2));
      tk.el.setAttribute('opacity', tk.o.toFixed(3));
    }
    if (this.zero) this.zero.attr('x1', L).attr('x2', W - R).attr('y1', y(0)).attr('y2', y(0));
    const line = d3.line().x((p) => x(p.t)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    const series = [...c.series].map(([key, s]) => ({ key, ...s }));
    this.gLines.selectAll('path.series').data(series, (d) => d.key).join('path').attr('class', 'series')
      .attr('stroke', (d) => d.color).attr('opacity', (d) => d.o).attr('d', (d) => line(d.pts));
    this.gDots.selectAll('circle').data(series, (d) => d.key).join('circle').attr('r', 3.2)
      .attr('fill', (d) => d.color).attr('opacity', (d) => d.o)
      .attr('cx', (d) => x(d.pts.at(-1).t)).attr('cy', (d) => y(d.pts.at(-1).v));
    // end labels, nudged apart so two close lines stay readable
    const ends = series.map((d) => ({ key: d.key, color: d.color, o: d.o, v: d.pts.at(-1).v, yy: y(d.pts.at(-1).v) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 11) ends[i].yy = ends[i - 1].yy + 11;
    this.gEnd.selectAll('text').data(ends, (d) => d.key).join('text').attr('x', W - R + 7).attr('dy', '0.32em')
      .attr('y', (d) => d.yy).attr('fill', (d) => d.color).attr('opacity', (d) => d.o).text((d) => this.o.endFmt(d.v, d.key));
  }

  drawBands(bands) {
    this.bands = bands;
    const [top, bottom] = bands;
    const { L, T, H, B } = this.o;
    this.gBands.selectAll('text').data([top, bottom]).join('text')
      .attr('x', this.o.W - this.o.R - 2).attr('text-anchor', 'end').attr('y', (d, i) => (i ? H - B - 5 : T + 9))
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
    this.cur = null; this.anim = null; this.bands = null;
    for (const m of [this.yTicks, this.xTicks]) { for (const tk of m.values()) if (tk.el) tk.el.remove(); m.clear(); }
    this.gLines.selectAll('*').remove(); this.gDots.selectAll('*').remove(); this.gEnd.selectAll('*').remove(); this.gBands.selectAll('*').remove();
    this.svg.style('display', 'none');
    this.msg.textContent = msg; this.msg.hidden = false;
  }
};
