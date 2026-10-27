'use strict';
// Motion system for the tracker, following Fluid Functionalism's rules (mickadesign/fluid-functionalism):
// three spring tiers picked by the size of what moves, exits one tier quicker as tweens,
// transform/opacity first, one hover highlight per list that glides to the nearest item,
// and reduced motion meaning "fewer and gentler" (fades stay, travel goes).
// Engine: Motion (motion.dev), the same library the @fluid components use, loaded as a browser build.
window.Fluid = (() => {
  const { animate } = window.Motion;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const spring = {
    fast: { type: 'spring', duration: 0.08, bounce: 0, exit: { duration: 0.06 } },     // hover, focus, fades
    moderate: { type: 'spring', duration: 0.16, bounce: 0, exit: { duration: 0.12 } }, // indicators, short travel
    slow: { type: 'spring', duration: 0.24, bounce: 0.12, exit: { duration: 0.16 } },  // large surfaces, row reorders
    // The one deliberate exception, hoisted here so it can't drift: live numbers, chart lines and bars.
    // Data needs to be *watched* changing, so it rides a longer critically damped spring than any UI tier.
    // Interruptible: a new update mid-flight starts from wherever the value is.
    data: { type: 'spring', duration: 0.9, bounce: 0 },
  };
  const strip = ({ exit, ...t }) => t;
  const tr = (tier) => (reduce.matches ? { duration: 0 } : strip(spring[tier] || tier));

  // Tween a plain number stored on `obj[key]`, calling apply(v) every frame. Interruptible.
  function tweenNum(obj, key, to, tier, apply) {
    const store = obj.__tw || (obj.__tw = {});
    const s = store[key] || (store[key] = { v: null, a: null });
    if (s.a) { s.a.stop(); s.a = null; }
    if (s.v == null || !Number.isFinite(s.v) || !Number.isFinite(to) || reduce.matches || tier === 'instant') { s.v = to; apply(to); return; }
    if (s.v === to) { apply(to); return; }
    s.a = animate(s.v, to, { ...tr(tier), onUpdate: (v) => { s.v = v; apply(v); }, onComplete: () => { s.v = to; apply(to); s.a = null; } });
  }

  // A number that rolls to its value. Sighted users see the roll; screen readers get the final text at once.
  // markup: <span class="tw"><span class="tw-v" aria-hidden="true"></span><span class="visually-hidden"></span></span>
  const NUM_HTML = '<span class="tw"><span class="tw-v" aria-hidden="true"></span><span class="visually-hidden"></span></span>';
  function setNum(wrap, value, fmt, { instant, tier } = {}) {
    const vis = wrap.firstElementChild, sr = wrap.lastElementChild;
    sr.textContent = value == null ? 'none' : fmt(value);
    if (value == null) { tweenNum(wrap, 'n', NaN, 'instant', () => {}); vis.textContent = '…'; return; }
    tweenNum(wrap, 'n', value, instant ? 'instant' : (tier || 'data'), (v) => { vis.textContent = fmt(v); });
  }

  // scaleX bar (transform only) that springs to its new fraction.
  function setBar(el, frac, { instant } = {}) {
    tweenNum(el, 'sx', Math.max(0, Math.min(1, frac || 0)), instant ? 'instant' : 'data', (v) => { el.style.transform = `scaleX(${v})`; });
  }

  // Text that changes identity (a new leader's name): crossfade in one cell, appear outlasts disappear.
  function setText(el, text, { instant } = {}) {
    if (el.textContent === text) return;
    if (instant || reduce.matches || !el.textContent) { el.textContent = text; return; }
    animate(el, { opacity: 0 }, spring.fast.exit).then(() => { el.textContent = text; animate(el, { opacity: 1 }, strip(spring.moderate)); });
  }

  // ---------- calm reorder (FLIP) ----------
  // Joshua's feedback: the 0.24 s spring made rank swaps "wayyyy too fast and jumpy". A rank change is
  // something people watch, like the live numbers, so it is the second deliberate exception to the UI
  // tiers: 600 ms ease-in-out (Emil: "moving on screen = ease-in-out"; easeInOutCubic from easings.net),
  // no spring, so there's no overshoot. Hoisted here so it can't drift.
  const MOVE = { duration: 0.6, ease: [0.65, 0, 0.35, 1] };
  const ENTER = { duration: 0.3, ease: [0.23, 1, 0.32, 1] }; // Emil's strong ease-out, opacity only
  const STAGGER = 0.018, STAGGER_MAX = 0.072;                // light: at most ~70 ms across the whole list

  // reorder(container, mutate, { now })
  //  - measures each child's on-screen top (including any in-flight transform), runs mutate(), then slides
  //    only the children whose position changed from where they *were* to where they are. Unmoved rows stay still.
  //  - Data updates that land mid-move are coalesced: the latest mutate waits and runs once when the
  //    current move settles (never a restart, never a stack of competing moves).
  //  - User-initiated changes ({ now: true }: sort, filter, race switch) retarget at once from the current
  //    on-screen positions, so there is no jump.
  //  - Reduced motion: no travel, the order just updates.
  function reorder(container, mutate, { now = false, onSettle, items } = {}) {
    // items(): the rows to track when they live in more than one list inside container (e.g. pinned top 3 + scroll list)
    const rows = items || (() => [...container.children]);
    const st = container.__ro || (container.__ro = { anims: new Map(), pending: null, t: 0 });
    if (st.anims.size && !now && performance.now() - st.t < 1500) { st.pending = { mutate, onSettle, items }; return; }
    st.pending = null;
    const kids = rows();
    const before = new Map(kids.map((k) => [k, k.getBoundingClientRect().top]));
    for (const [k, a] of st.anims) { a.stop(); k.style.transform = ''; k.style.zIndex = ''; k.classList.remove('ro-moving'); }
    st.anims.clear();
    mutate();
    if (reduce.matches) { onSettle && onSettle(); return; }
    const moves = [];
    for (const k of rows()) {
      const b = before.get(k);
      if (b == null) { if (!k.__entered) { k.__entered = true; animate(k, { opacity: [0, 1] }, ENTER); } continue; }
      const r = k.getBoundingClientRect();
      // A row arriving from far offscreen starts just past the viewport edge instead of whipping across
      // thousands of pixels; where it started is invisible anyway.
      const vh = innerHeight, pad = r.height + 40;
      const from = b < -pad ? Math.max(b, Math.min(r.top, 0) - pad) : b > vh + pad ? Math.min(b, Math.max(r.top, vh) + pad) : b;
      const dy = from - r.top;
      if (Math.abs(dy) >= 0.5) moves.push([k, dy]);
    }
    if (!moves.length) { onSettle && onSettle(); return; }
    st.t = performance.now();
    // Rows climbing the ranking pass over the ones sliding down.
    moves.forEach(([k, dy], i) => {
      k.style.transform = `translateY(${dy}px)`;
      k.style.zIndex = dy > 0 ? '2' : '1';
      k.classList.add('ro-moving');
      const a = animate(k, { transform: [`translateY(${dy}px)`, 'translateY(0px)'] }, { ...MOVE, delay: Math.min(i * STAGGER, STAGGER_MAX) });
      st.anims.set(k, a);
      a.finished.then(() => {
        if (st.anims.get(k) !== a) return;
        st.anims.delete(k); k.style.transform = ''; k.style.zIndex = ''; k.classList.remove('ro-moving');
        if (st.anims.size) return;
        onSettle && onSettle();
        const next = st.pending;
        if (next) { st.pending = null; requestAnimationFrame(() => reorder(container, next.mutate, { onSettle: next.onSettle, items: next.items })); }
      }, () => {});
    });
  }
  // Back-compat name used elsewhere in the app.
  const flip = (container, mutate) => reorder(container, mutate, { now: true });

  // One hover highlight per list. The item whose centre is nearest the pointer lights up, so the
  // highlight never blinks off in a gap; it fades in where the pointer enters instead of sliding across.
  // Only click targets register (items()), and a click in a gap activates the lit item.
  function fluidHover(container, { items, axis = 'y', className = '', onActivate }) {
    const hl = document.createElement('div');
    hl.className = 'fluid-hl ' + className;
    hl.setAttribute('aria-hidden', 'true');
    container.prepend(hl);
    let active = null, shown = false;
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    function rectOf(el) {
      const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - c.left + container.scrollLeft, y: r.top - c.top + container.scrollTop, w: r.width, h: r.height };
    }
    function place(el, jump) {
      const r = rectOf(el);
      const t = jump ? { duration: 0 } : tr('fast');
      animate(hl, { x: r.x, y: r.y, width: r.w + 'px', height: r.h + 'px' }, t);
    }
    function nearest(e) {
      let best = null, bd = Infinity;
      for (const el of items()) {
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        const d = axis === 'x' ? Math.abs(e.clientX - (r.left + r.width / 2)) : Math.abs(e.clientY - (r.top + r.height / 2));
        if (d < bd) { bd = d; best = el; }
      }
      return best;
    }
    container.addEventListener('pointermove', (e) => {
      if (!fine.matches) return;
      const el = nearest(e);
      if (!el) return;
      if (!shown) { place(el, true); animate(hl, { opacity: 1 }, tr('fast')); shown = true; }
      else if (el !== active) place(el, false);
      active = el;
    });
    container.addEventListener('pointerleave', () => { shown = false; active = null; animate(hl, { opacity: 0 }, reduce.matches ? { duration: 0 } : spring.fast.exit); });
    container.addEventListener('click', (e) => {
      if (!onActivate || !active) return;
      if (e.target.closest('button, a, input, select, summary')) return; // real controls handle themselves
      onActivate(active);
    });
    return { refresh: () => { if (shown && active && active.isConnected) place(active, true); else if (shown) { shown = false; animate(hl, { opacity: 0 }, { duration: 0 }); } } };
  }

  // Segmented control indicator: one pill that springs between options (moderate: short travel).
  function segmented(group) {
    const ind = document.createElement('span');
    ind.className = 'seg-indicator';
    ind.setAttribute('aria-hidden', 'true');
    group.prepend(ind);
    let first = true;
    return function update() {
      const on = group.querySelector('[aria-pressed="true"]');
      if (!on) return;
      const t = first || reduce.matches ? { duration: 0 } : tr('moderate');
      animate(ind, { x: on.offsetLeft, width: on.offsetWidth + 'px', height: on.offsetHeight + 'px', y: on.offsetTop }, t);
      first = false;
    };
  }

  return { spring, tr, tweenNum, NUM_HTML, setNum, setBar, setText, flip, reorder, fluidHover, segmented, reduce, animate };
})();
