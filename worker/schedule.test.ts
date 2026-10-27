import { describe, expect, it } from "vite-plus/test";
import { scheduleDelay } from "./schedule.js";

const now = 1_700_000_000_000;

describe("scheduleDelay", () => {
  it("waits 20s when the feed is in error, unpublished, or stale", () => {
    expect(scheduleDelay(now, now - 1_000, true)).toBe(20_000);
    expect(scheduleDelay(now, null, false)).toBe(20_000);
    expect(scheduleDelay(now, now - 60_000, false)).toBe(20_000);
    expect(scheduleDelay(now, now - 120_000, false)).toBe(20_000);
  });

  it("reads a fresh file 1s after the next 60s publication", () => {
    expect(scheduleDelay(now, now - 1_000, false)).toBe(60_000);
    expect(scheduleDelay(now, now - 59_000, false)).toBe(2_000);
    // Inside the last 1.5s the server floors the wait at 1.5s rather than skipping the publication.
    expect(scheduleDelay(now, now - 59_999, false)).toBe(1_500);
    expect(scheduleDelay(now, now - 59_500, false)).toBe(1_500);
  });
});
