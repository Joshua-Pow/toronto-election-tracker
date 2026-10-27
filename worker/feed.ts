import { DurableObject } from "cloudflare:workers";
import normalizeMod from "../lib/normalize.js";
import { CATCHUP_MS, scheduleDelay } from "./schedule.js";

const normalize = normalizeMod.normalize as (
  all: unknown,
  ward: unknown,
  options?: { publishedAt?: number | null },
) => Normalized;

const FEEDS = {
  all: "https://mediaresults.toronto.ca/results/unofficialresult.json",
  ward: "https://mediaresults.toronto.ca/results/unofficialresult-wardbyward.json",
} as const;

const USER_AGENT =
  "toronto-vote-tracker/1.0 (personal; 1/min once the file is publishing, 20s until it changes)";
const FEED_MAX_BYTES = 20 * 1024 * 1024;
const HISTORY_MAX = 2000;
const BODY_MAX_BYTES = 1_500_000;
const RAW_MAX_BYTES = 1_700_000;

type FeedKey = keyof typeof FEEDS;

interface Normalized {
  publishedAt: number | null;
  seq?: string;
  mayor: {
    pollsReceived: number;
    polls: number;
    votesReceived: number;
    candidates: { name: string; votes: number }[];
  };
  wards: unknown[];
  [key: string]: unknown;
}

interface Snap {
  t: number;
  fetchedAt: number;
  seq: string;
  pollsReceived: number;
  polls: number;
  votes: number;
  c: Record<string, number>;
}

export interface ReadQuery {
  demo: boolean;
  p: number | null;
  live: boolean;
}

export interface ReadResult {
  body: string;
  etag: string;
  cacheControl: string;
}

interface CityJson {
  seq?: string | number;
}

function numOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function feedErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "City feed timed out";
  const raw = error instanceof Error ? error.message : String(error);
  if (/^(all|ward) feed /.test(raw)) return raw.slice(0, 80);
  if (error instanceof SyntaxError) return "City feed was not valid JSON";
  return "City feed unreachable";
}

async function sha1Etag(body: string, prefix = ""): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body));
  let bin = "";
  for (const byte of new Uint8Array(digest)) bin += String.fromCharCode(byte);
  const b64 = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `"${prefix}${b64.slice(0, 20)}"`;
}

async function readCapped(res: Response, max: number, key: FeedKey): Promise<string> {
  if (!res.body) throw new Error(`${key} feed empty`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`${key} feed too large`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export class CityFeed extends DurableObject<Env> {
  private meta = new Map<string, string>();
  private history: Snap[] = [];
  private historyLoaded = false;
  private parsed: { all: CityJson | null; ward: CityJson | null } = { all: null, ward: null };
  private state: Normalized | null = null;
  private stateLoaded = false;
  private polling = false;
  private memoryBody: { body: string; etag: string } | null = null;
  private demoMemo = new Map<string, { body: string; etag: string }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, snap TEXT NOT NULL)",
      );
      this.loadMeta();
    });
  }

  async read(query: ReadQuery): Promise<ReadResult> {
    if (query.demo) {
      await this.ensureAlarm();
      return this.demo(query);
    }
    await this.ensureStarted();
    return this.livePayload();
  }

  async health(): Promise<{ ok: true; lastCheckAt: number | null; error: string | null }> {
    const error = this.parseError();
    return {
      ok: true,
      lastCheckAt: numOrNull(this.meta.get("lastCheckAt")),
      error: error ? error.message : null,
    };
  }

  async alarm(): Promise<void> {
    try {
      await this.poll();
      this.putMeta("booted", "1");
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "city alarm failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await this.arm(scheduleDelay(Date.now(), this.publishedAt(), this.hasError()));
  }

  private async ensureStarted(): Promise<void> {
    if (this.meta.get("booted") !== "1") {
      await this.poll();
      this.putMeta("booted", "1");
      await this.arm(scheduleDelay(Date.now(), this.publishedAt(), this.hasError()));
      return;
    }
    await this.ensureAlarm();
  }

  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null)
      await this.arm(
        this.meta.get("booted") === "1"
          ? scheduleDelay(Date.now(), this.publishedAt(), this.hasError())
          : 1_500,
      );
  }

  private async arm(delay: number): Promise<void> {
    const when = Date.now() + delay;
    this.putMeta("nextCheckAt", String(when));
    try {
      await this.refreshLiveBody();
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "live body refresh failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await this.ctx.storage.setAlarm(when);
    console.log(
      JSON.stringify({
        message: "city check scheduled",
        delayMs: delay,
        seq: this.meta.get("all_seq") ?? null,
        publishedAt: this.publishedAt(),
      }),
    );
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const all = await this.fetchFeed("all");
      const ward = await this.fetchFeed("ward");
      this.putMeta("lastCheckAt", String(Date.now()));
      this.putMeta("error", null);
      if (all.changed || ward.changed) {
        this.putMeta("lastChangeAt", String(Date.now()));
        await this.rebuildFromFeeds();
        this.recordSnapshot();
        console.log(
          JSON.stringify({
            message: "city feed changed",
            all: all.status,
            ward: ward.status,
            seq: this.meta.get("all_seq") ?? null,
          }),
        );
      }
    } catch (error) {
      const message = feedErrorMessage(error);
      this.putMeta("error", JSON.stringify({ at: Date.now(), message }));
      console.error(JSON.stringify({ message: "city feed failed", error: message }));
    } finally {
      this.polling = false;
    }
  }

  private async fetchFeed(
    key: FeedKey,
    force = false,
  ): Promise<{ changed: boolean; status: number }> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };
    const hasBody = Boolean(this.parsed[key] || this.meta.get(`${key}_json`));
    const etag = this.meta.get(`${key}_etag`);
    const lastModified = this.meta.get(`${key}_lm`);
    if (!force && hasBody && etag) headers["If-None-Match"] = etag;
    if (!force && hasBody && lastModified) headers["If-Modified-Since"] = lastModified;
    const res = await fetch(FEEDS[key], {
      headers,
      signal: AbortSignal.timeout(20_000),
      cf: { cacheTtl: 0 },
    });
    if (res.status === 304) return { changed: false, status: 304 };
    if (!res.ok) throw new Error(`${key} feed HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") || 0) > FEED_MAX_BYTES)
      throw new Error(`${key} feed too large`);
    const text = await readCapped(res, FEED_MAX_BYTES, key);
    let json: CityJson;
    try {
      json = JSON.parse(text) as CityJson;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      throw new SyntaxError("City feed was not valid JSON");
    }
    const prev = this.meta.get(`${key}_seq`);
    const changed = prev == null || String(json.seq) !== prev;
    this.parsed[key] = json;
    this.putMeta(`${key}_seq`, String(json.seq ?? ""));
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes <= RAW_MAX_BYTES) {
      this.putMeta(`${key}_json`, text);
      this.putMeta(`${key}_etag`, res.headers.get("etag"));
      this.putMeta(`${key}_lm`, res.headers.get("last-modified"));
    } else {
      this.putMeta(`${key}_json`, null);
      this.putMeta(`${key}_etag`, null);
      this.putMeta(`${key}_lm`, null);
    }
    return { changed, status: res.status };
  }

  private loadParsed(key: FeedKey): void {
    if (this.parsed[key]) return;
    const text = this.meta.get(`${key}_json`);
    if (!text) return;
    this.parsed[key] = JSON.parse(text) as CityJson;
  }

  private async rebuildFromFeeds(): Promise<void> {
    this.loadParsed("all");
    this.loadParsed("ward");
    if (!this.parsed.all) await this.fetchFeed("all", true);
    if (!this.parsed.ward) await this.fetchFeed("ward", true);
    if (!this.parsed.all) throw new Error("all feed missing");
    this.state = normalize(this.parsed.all, this.parsed.ward, { publishedAt: this.publishedAt() });
    this.stateLoaded = true;
    this.putMeta("state_json", JSON.stringify(this.state));
  }

  private recordSnapshot(): void {
    const current = this.state;
    if (!current?.mayor) return;
    this.ensureHistory();
    const snap: Snap = {
      t: current.publishedAt || Date.now(),
      fetchedAt: Date.now(),
      seq: String(this.meta.get("all_seq") ?? ""),
      pollsReceived: current.mayor.pollsReceived,
      polls: current.mayor.polls,
      votes: current.mayor.votesReceived,
      c: Object.fromEntries(
        current.mayor.candidates.filter((c) => c.votes > 0).map((c) => [c.name, c.votes]),
      ),
    };
    const last = this.history[this.history.length - 1];
    if (
      last &&
      last.votes === snap.votes &&
      last.pollsReceived === snap.pollsReceived &&
      JSON.stringify(last.c) === JSON.stringify(snap.c)
    )
      return;
    this.history.push(snap);
    this.ctx.storage.sql.exec("INSERT INTO history (snap) VALUES (?)", JSON.stringify(snap));
    if (this.history.length > HISTORY_MAX) this.trimHistory(Math.floor(HISTORY_MAX * 0.9));
    this.putMeta("history_len", String(this.history.length));
  }

  private trimHistory(keep: number): void {
    this.ensureHistory();
    this.history = this.history.slice(-keep);
    this.ctx.storage.sql.exec(
      "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)",
      keep,
    );
    this.putMeta("history_len", String(this.history.length));
  }

  private publishedAt(): number | null {
    const seq = Number(this.meta.get("all_seq"));
    if (seq > 1.6e12 && seq < 2.2e12) return seq;
    const lm = this.meta.get("all_lm");
    return lm ? Date.parse(lm) : null;
  }

  private hasError(): boolean {
    return Boolean(this.meta.get("error"));
  }

  private parseError(): { at: number; message: string } | null {
    const raw = this.meta.get("error");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { at?: number; message?: string };
      if (!parsed.message) return null;
      return { at: parsed.at || Date.now(), message: parsed.message };
    } catch {
      return null;
    }
  }

  private ensureState(): void {
    if (this.stateLoaded) return;
    this.stateLoaded = true;
    const raw = this.meta.get("state_json");
    if (!raw) return;
    try {
      this.state = JSON.parse(raw) as Normalized;
    } catch {
      this.state = null;
    }
  }

  private ensureHistory(): void {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    const rows = this.ctx.storage.sql
      .exec<{ snap: string }>("SELECT snap FROM history ORDER BY id")
      .toArray();
    this.history = [];
    for (const row of rows) {
      try {
        this.history.push(JSON.parse(row.snap) as Snap);
      } catch {
        /* drop a corrupt snapshot */
      }
    }
  }

  private buildLiveBody(): string {
    this.ensureState();
    this.ensureHistory();
    const next = numOrNull(this.meta.get("nextCheckAt"));
    const state = this.state ?? { mayor: null, wards: [], publishedAt: null };
    return JSON.stringify({
      mode: "live",
      sample: false,
      lastCheckAt: numOrNull(this.meta.get("lastCheckAt")),
      lastChangeAt: numOrNull(this.meta.get("lastChangeAt")),
      nextCheckAt: next,
      pollMs: next ? Math.max(0, next - Date.now()) : CATCHUP_MS,
      error: this.parseError(),
      source: FEEDS,
      ...state,
      history: this.history.filter((snap) => snap.votes > 0),
    });
  }

  private async refreshLiveBody(): Promise<void> {
    let body = this.buildLiveBody();
    while (new TextEncoder().encode(body).byteLength > BODY_MAX_BYTES && this.history.length > 1) {
      this.trimHistory(Math.max(1, Math.floor(this.history.length * 0.9)));
      body = this.buildLiveBody();
    }
    const etag = await sha1Etag(body);
    try {
      this.putMeta("live_body", body);
      this.putMeta("live_etag", etag);
      this.memoryBody = null;
    } catch (error) {
      this.memoryBody = { body, etag };
      console.error(
        JSON.stringify({
          message: "live body kept in memory",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private livePayload(): ReadResult {
    if (this.memoryBody) return { ...this.memoryBody, cacheControl: "public, max-age=2" };
    const body = this.meta.get("live_body");
    const etag = this.meta.get("live_etag");
    if (body && etag) return { body, etag, cacheControl: "public, max-age=2" };
    const fresh = this.buildLiveBody();
    return { body: fresh, etag: '"pending"', cacheControl: "public, max-age=2" };
  }

  private async demo(query: ReadQuery): Promise<ReadResult> {
    const seq = this.meta.get("all_seq") ?? "";
    const key = `${query.p}|${query.live}|${Math.floor(Date.now() / 1000)}|${seq}`;
    const cached = this.demoMemo.get(key);
    if (cached)
      return { ...cached, cacheControl: query.live ? "public, max-age=2" : "public, max-age=10" };
    const { buildDemoState } = (await import("../lib/demo.js")) as {
      buildDemoState: (
        all: unknown,
        ward: unknown,
        options: { progress: number | null; live: boolean },
      ) => { now?: number };
    };
    const allFixture = (await import("../fixtures/unofficialresult.json")).default;
    const wardFixture = (await import("../fixtures/unofficialresult-wardbyward.json")).default;
    this.loadParsed("all");
    this.loadParsed("ward");
    const { now: _now, ...state } = buildDemoState(
      this.parsed.all ?? allFixture,
      this.parsed.ward ?? wardFixture,
      {
        progress: query.p,
        live: query.live,
      },
    );
    const body = JSON.stringify(state);
    const etag = await sha1Etag(body, "d");
    const entry = { body, etag };
    this.demoMemo.set(key, entry);
    if (this.demoMemo.size > 128) this.demoMemo.delete(this.demoMemo.keys().next().value!);
    return { ...entry, cacheControl: query.live ? "public, max-age=2" : "public, max-age=10" };
  }

  private loadMeta(): void {
    const rows = this.ctx.storage.sql
      .exec<{ k: string; v: string }>("SELECT k, v FROM meta")
      .toArray();
    this.meta = new Map(rows.map((row) => [row.k, row.v]));
  }

  private putMeta(key: string, value: string | null): void {
    if (value == null || value === "") {
      this.meta.delete(key);
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = ?", key);
      return;
    }
    this.meta.set(key, value);
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      value,
    );
  }
}
