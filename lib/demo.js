'use strict';
// SAMPLE DATA generator for ?demo=1. Uses the real ballot structure (candidate names, wards,
// poll counts) but entirely made-up vote counts from a seeded random generator. These numbers
// are not a forecast and must never be shown without the SAMPLE DATA label (sample: true).
const { normalize } = require('./normalize');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const CYCLE_MS = 6 * 60 * 1000; // demo count replays every 6 minutes
// ?demo=1&live=1: a simulated live night. The sample count steps forward every LIVE_STEP_MS and
// replays every LIVE_CYCLE_MS, so the page's motion can be watched. Still sample data.
const LIVE_STEP_MS = 4000;
const LIVE_CYCLE_MS = 3 * 60 * 1000;
const GRID = 36; // history snapshots sit on a fixed grid so earlier points never move between updates
const SPAN = 3 * 60 * 60 * 1000; // a fixed-progress sample (?demo=1&p=…) pretends the full count takes 3 hours

function wardProfile(wnum, cands) {
  const r = rng(1000 + Number(wnum) * 7919);
  const w = cands.map((name) => {
    if (/Olivia Chow/.test(name)) return 30 + r() * 40;
    if (/Brad Bradford/.test(name)) return 30 + r() * 40;
    if (/Chris Alexander/.test(name)) return 1 + r() * 4;
    return r() < 0.15 ? r() * 2 : r() * 0.25;
  });
  return w;
}

function synthFeeds(all, ward, p) {
  const A = JSON.parse(JSON.stringify(all));
  const W = JSON.parse(JSON.stringify(ward));
  const mayorNames = W.office.candidate.map((c) => c.name.trim());
  const cityTotals = new Map(mayorNames.map((nm) => [nm, 0]));
  let cityPolls = 0, cityVotes = 0;
  const wards = W.office.candidate[0].ward;
  const perWard = wards.map((w) => {
    const r = rng(77 + Number(w.num) * 31);
    const lag = r() * 0.35; // some wards report later
    const wp = Math.max(0, Math.min(1, (p - lag * (1 - p)) * (1 + r() * 0.1)));
    const polls = Number(w.polls);
    const pr = p >= 1 ? polls : Math.floor(polls * wp);
    const turnout = 0.28 + r() * 0.12;
    const votes = Math.round(Number(w.totalVoters) * turnout * (pr / polls));
    const weights = wardProfile(w.num, mayorNames);
    const drift = rng(5 + Number(w.num) + Math.floor(p * 20));
    const adj = weights.map((x) => x * (0.97 + drift() * 0.06));
    const sum = adj.reduce((s, x) => s + x, 0);
    const v = adj.map((x) => Math.round((votes * x) / sum));
    cityPolls += pr; cityVotes += v.reduce((s, x) => s + x, 0);
    mayorNames.forEach((nm, i) => cityTotals.set(nm, cityTotals.get(nm) + v[i]));
    return { num: w.num, pr, v };
  });
  W.office.candidate.forEach((c, i) => {
    c.ward.forEach((w, j) => { const pw = perWard[j]; w.pollsReceived = String(pw.pr); w.votesReceived = String(pw.v[i]); w.votesCounted = String(pw.v.reduce((s, x) => s + x, 0)); });
    c.votesReceived = String(cityTotals.get(c.name.trim()));
  });
  W.office.pollsReceived = String(cityPolls); W.office.votesReceived = String(cityVotes);
  const mw = A.office.find((o) => String(o.id) === '1').ward[0];
  mw.pollsReceived = String(cityPolls); mw.votesReceived = String(cityVotes);
  mw.candidate.forEach((c) => { c.votesReceived = String(cityTotals.get(c.name.trim()) || 0); });
  const council = A.office.find((o) => String(o.id) === '2');
  for (const cw of council.ward) {
    const pw = perWard.find((x) => String(x.num) === String(cw.num));
    const r = rng(4242 + Number(cw.num) * 101);
    const weights = cw.candidate.map((_, i) => (i === 0 ? 0 : 0) + Math.pow(r(), 2.2) * 100 + 1);
    const total = pw ? pw.v.reduce((s, x) => s + x, 0) : 0;
    const sum = weights.reduce((s, x) => s + x, 0);
    cw.pollsReceived = String(pw ? pw.pr : 0); cw.votesReceived = String(total);
    cw.candidate.forEach((c, i) => { c.votesReceived = String(Math.round((total * weights[i]) / sum)); });
  }
  return { A, W };
}

function buildDemoState(all, ward, { progress, live } = {}) {
  if (!all || !ward) return { mode: 'demo', sample: true, error: { at: Date.now(), message: 'Ballot structure not loaded yet (City feed unreachable).' }, mayor: null, wards: [], history: [] };
  const now = Date.now();
  // Sample clock: every sample timestamp is relative to now and never in the future.
  // timeAt(q) is when the sample count reached progress q.
  let p, nextCheckAt, pollMs, timeAt;
  if (progress != null) {
    p = progress; pollMs = 15000; nextCheckAt = now + pollMs;
    const anchor = Math.floor(now / 60000) * 60000; // "published" on the last whole minute
    timeAt = (q) => anchor - (Math.min(1, p) - q) * SPAN;
  } else {
    const cycle = live ? LIVE_CYCLE_MS : CYCLE_MS, over = live ? 1.12 : 1.15; // the tail of each cycle sits at "complete"
    const at = live ? Math.floor(now / LIVE_STEP_MS) * LIVE_STEP_MS : now;
    const cycleStart = at - (at % cycle);
    p = ((at % cycle) / cycle) * over;
    timeAt = (q) => cycleStart + (q * cycle) / over; // a sped-up count that started at cycleStart
    pollMs = live ? LIVE_STEP_MS : 15000; nextCheckAt = live ? at + LIVE_STEP_MS : now + pollMs;
  }
  const pc = Math.min(1, p);
  const { A, W } = synthFeeds(all, ward, pc);
  const fakeTime = Math.min(now, timeAt(pc));
  const st = normalize(A, W, { publishedAt: fakeTime });
  const history = [];
  const qs = [];
  for (let k = 1; k <= Math.floor(pc * GRID + 1e-9); k++) qs.push(k / GRID);
  if (pc > 0 && (!qs.length || qs[qs.length - 1] < pc - 1e-9)) qs.push(pc);
  for (const q of qs) {
    const s = normalize(...Object.values(synthFeeds(all, ward, q)), {});
    if (!s.mayor.total) continue;
    history.push({ t: Math.min(now, timeAt(q)), pollsReceived: s.mayor.pollsReceived, polls: s.mayor.polls, votes: s.mayor.total, c: Object.fromEntries(s.mayor.candidates.slice(0, 8).map((c) => [c.name, c.votes])) });
  }
  return { mode: 'demo', sample: true, simulatedLive: !!live && progress == null, progress: pc, now, lastCheckAt: now, lastChangeAt: now, nextCheckAt, pollMs, error: null, ...st, history };
}

module.exports = { buildDemoState };
