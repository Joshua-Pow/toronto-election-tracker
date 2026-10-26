'use strict';
// Turns the City's string-typed feeds into one tidy model the frontend renders.
// Every number here comes straight from the feed; percentages and margins are arithmetic on them.

const n = (v) => {
  const x = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};

function rank(cands) {
  const total = cands.reduce((s, c) => s + c.votes, 0);
  const list = cands
    .map((c) => ({ ...c, pct: total > 0 ? (c.votes / total) * 100 : 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const [a, b] = list;
  const hasVotes = total > 0;
  const tie = hasVotes && b && a.votes === b.votes;
  return {
    total,
    candidates: list,
    leader: hasVotes && !tie ? a.name : null,
    tie,
    runnerUp: hasVotes && b ? b.name : null,
    marginVotes: hasVotes && b ? a.votes - b.votes : null,
    marginPts: hasVotes && b ? a.pct - b.pct : null,
    leaderPct: hasVotes ? a.pct : null,
  };
}

function normalize(all, ward, { publishedAt } = {}) {
  const offices = (all && all.office) || [];
  const mayorOffice = offices.find((o) => String(o.id) === '1') || offices[0];
  const councilOffice = offices.find((o) => String(o.id) === '2');
  const cw = (mayorOffice && mayorOffice.ward && mayorOffice.ward[0]) || {};

  const mayorRank = rank((cw.candidate || []).map((c) => ({ name: c.name.trim(), votes: n(c.votesReceived) })));
  const mayor = {
    polls: n(cw.polls), pollsReceived: n(cw.pollsReceived), totalVoters: n(cw.totalVoters),
    votesReceived: n(cw.votesReceived) || mayorRank.total,
    ...mayorRank,
  };

  // Mayor by ward: candidate -> ward[] ; pivot to ward -> candidate[]
  const wardMap = new Map();
  const wo = ward && ward.office;
  for (const c of (wo && wo.candidate) || []) {
    for (const w of c.ward || []) {
      const k = String(n(w.num));
      if (!wardMap.has(k)) wardMap.set(k, { num: k, name: w.name, polls: n(w.polls), pollsReceived: n(w.pollsReceived), totalVoters: n(w.totalVoters), votesCounted: n(w.votesCounted), cands: [] });
      wardMap.get(k).cands.push({ name: c.name.trim(), votes: n(w.votesReceived) });
    }
  }
  const councilByNum = new Map(((councilOffice && councilOffice.ward) || []).map((w) => [String(n(w.num)), w]));

  const nums = new Set([...wardMap.keys(), ...councilByNum.keys()]);
  const wards = [...nums].sort((a, b) => Number(a) - Number(b)).map((k) => {
    const m = wardMap.get(k);
    const c = councilByNum.get(k);
    const mr = m ? rank(m.cands) : null;
    const cr = c ? rank((c.candidate || []).map((x) => ({ name: x.name.trim(), votes: n(x.votesReceived) }))) : null;
    return {
      num: k,
      name: (m && m.name) || (c && c.name) || `Ward ${k}`,
      mayor: m ? { polls: m.polls, pollsReceived: m.pollsReceived, totalVoters: m.totalVoters, ...mr, candidates: mr.candidates.slice(0, 6) } : null,
      council: c ? { polls: n(c.polls), pollsReceived: n(c.pollsReceived), totalVoters: n(c.totalVoters), votesReceived: n(c.votesReceived) || cr.total, ...cr } : null,
    };
  });

  return {
    electionDesc: all && all.electionDesc,
    seq: all && String(all.seq),
    wardSeq: ward && String(ward.seq),
    publishedAt: publishedAt || null,
    mayor,
    wards,
  };
}

module.exports = { normalize, rank, n };
