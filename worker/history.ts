export interface HistorySnap {
  t: number;
  votes: number;
}

// Local snapshots fill in the evening the Durable Object did not see. A snapshot
// already stored on the Worker wins when the timestamps match.
export function mergeHistory<T extends HistorySnap>(existing: T[], seed: T[]): T[] {
  const byT = new Map<number, T>();
  for (const snap of seed) {
    if (snap && snap.votes > 0 && Number.isFinite(snap.t)) byT.set(snap.t, snap);
  }
  for (const snap of existing) {
    if (snap && snap.votes > 0 && Number.isFinite(snap.t)) byT.set(snap.t, snap);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function seedRevision(seed: HistorySnap[]): string {
  const first = seed.find((snap) => snap && snap.votes > 0 && Number.isFinite(snap.t));
  const last = [...seed]
    .reverse()
    .find((snap) => snap && snap.votes > 0 && Number.isFinite(snap.t));
  const count = seed.filter((snap) => snap && snap.votes > 0 && Number.isFinite(snap.t)).length;
  return `${count}:${first?.t ?? 0}:${last?.t ?? 0}`;
}
