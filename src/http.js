// One cached JSON fetcher for every external call (Qloo, OpenStreetMap).
// SQLite cache, 24 h TTL. OFFLINE=1 turns a cache miss into an error that names the URL
// (used to replay recorded demo data and to run the tests without network).
import fs from "node:fs";
import path from "node:path";

const TTL_MS = 24 * 3600 * 1000;
const PINNED = Number.MAX_SAFE_INTEGER; // recorded fixtures never expire

// Store: SQLite locally (persistent, used for recorded fixtures and tests); in memory on hosts where the
// native SQLite module is not available or the disk is ephemeral anyway (CACHE_MEMORY=1, e.g. Render free).
let getStmt, putStmt, fb = null;
if (process.env.CACHE_MEMORY === "1") {
  const mem = new Map();
  getStmt = { get: (k) => mem.get(k) };
  putStmt = { run: (k, v, t) => { mem.set(k, { v, t }); if (mem.size > 5000) mem.delete(mem.keys().next().value); } };
} else {
  const { default: Database } = await import("better-sqlite3");
  const DB_PATH = process.env.CACHE_PATH || "data/cache.sqlite";
  fs.mkdirSync(DB_PATH.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  const db = new Database(DB_PATH);
  // Recorded responses for the demo examples (local only, never in the public repo): used if a live call fails.
  const FALLBACK = process.env.FALLBACK_PATH ?? "fixtures/demo.sqlite";
  fb = fs.existsSync(FALLBACK) && path.resolve(FALLBACK) !== path.resolve(DB_PATH) ? new Database(FALLBACK, { readonly: true }) : null;
  db.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, t INTEGER)");
  getStmt = db.prepare("SELECT v, t FROM cache WHERE k = ?");
  putStmt = db.prepare("INSERT OR REPLACE INTO cache (k, v, t) VALUES (?, ?, ?)");
}

export function putCache(url, json, pinned = false) {
  putStmt.run(url, JSON.stringify(json), pinned ? PINNED : Date.now());
}

export const misses = new Set();

/** Is a fresh response for this URL already cached? (callers skip their rate limiting for cache hits) */
export function isCached(url) {
  const hit = getStmt.get(url);
  return !!hit && (hit.t === PINNED || Date.now() - hit.t < TTL_MS);
}

export class CacheMiss extends Error {
  constructor(url) {
    super(`cache miss (offline): ${url}`);
    this.code = "MISS";
    this.url = url;
  }
}

export async function getJSON(url, { headers = {}, source = "http", trace } = {}) {
  const t0 = Date.now();
  const hit = getStmt.get(url);
  if (hit && (hit.t === PINNED || Date.now() - hit.t < TTL_MS)) {
    trace?.add({ source, url, ms: Date.now() - t0, cached: true });
    return JSON.parse(hit.v);
  }
  if (process.env.OFFLINE === "plan") {
    // planning run: note the call and pretend it came back empty, to discover every call a case needs
    misses.add(url);
    return { results: {} };
  }
  if (process.env.OFFLINE === "1") {
    misses.add(url);
    trace?.add({ source, url, ms: 0, cached: false, error: "not recorded" });
    throw new CacheMiss(url);
  }
  let res, json;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    trace?.add({ source, url, ms: Date.now() - t0, cached: false, error: String(e.message).slice(0, 120) });
    const r = fallback(url, source, trace);
    if (r) return r;
    throw e;
  }
  if (!res.ok) {
    trace?.add({ source, url, ms: Date.now() - t0, cached: false, error: `HTTP ${res.status}` });
    const r = fallback(url, source, trace);
    if (r) return r;
    throw new Error(`${source} ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  putCache(url, json);
  trace?.add({ source, url, ms: Date.now() - t0, cached: false });
  return json;
}

function fallback(url, source, trace) {
  const hit = fb?.prepare("SELECT v FROM cache WHERE k = ?").get(url);
  if (!hit) return null;
  trace?.add({ source, url, ms: 0, cached: true, recorded: true });
  return JSON.parse(hit.v);
}

export function makeTrace() {
  const entries = [];
  return { entries, add: (e) => entries.push(e) };
}
