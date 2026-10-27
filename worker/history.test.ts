import { describe, expect, it } from "vite-plus/test";
import { mergeHistory, seedRevision } from "./history.js";

const local = { t: 1, votes: 10 };
const later = { t: 2, votes: 20 };
const sameTime = { t: 1, votes: 11 };

describe("mergeHistory", () => {
  it("keeps the local evening and the points recorded after deploy, in time order", () => {
    expect(mergeHistory([later], [local])).toEqual([local, later]);
  });

  it("keeps the stored snapshot when a seeded one has the same timestamp", () => {
    expect(mergeHistory([sameTime], [local])).toEqual([sameTime]);
  });

  it("drops empty snapshots", () => {
    expect(mergeHistory([], [local, { t: 3, votes: 0 }])).toEqual([local]);
  });
});

describe("seedRevision", () => {
  it("changes when the seeded file gains a later snapshot", () => {
    expect(seedRevision([local])).not.toBe(seedRevision([local, later]));
  });
});
