// Same schedule as server.js. The City republishes about every 60s. seq is that
// publication time (epoch ms). A fresh file is read 1s after the next publication.
// A stale file, a missed publication, or an error is checked every 20s, never faster.
export const PERIOD_MS = 60_000;
export const LAG_MS = 1_000;
export const CATCHUP_MS = 20_000;

export function scheduleDelay(now: number, published: number | null, hasError: boolean): number {
  if (hasError) return CATCHUP_MS;
  if (!published) return CATCHUP_MS;
  const age = now - published;
  if (age >= PERIOD_MS) return CATCHUP_MS;
  // age < 60s, so publishedAt + 60s + 1s is still ahead (at least 1s). Never skip that publication.
  return Math.max(1500, published + PERIOD_MS + LAG_MS - now);
}
