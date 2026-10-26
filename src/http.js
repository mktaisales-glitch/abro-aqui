// One cached JSON fetcher for every external call (Qloo, OpenStreetMap).
// SQLite cache, 24 h TTL. OFFLINE=1 turns a cache miss into an error that names the URL
// (used to replay recorded demo data and to run the tests without network).
import Database from "better-sqlite3";
import fs from "node:fs";

const TTL_MS = 24 * 3600 * 1000;
const DB_PATH = process.env.CACHE_PATH || "data/cache.sqlite";
fs.mkdirSync(DB_PATH.split("/").slice(0, -1).join("/") || ".", { recursive: true });
const db = new Database(DB_PATH);
db.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, t INTEGER)");
const getStmt = db.prepare("SELECT v, t FROM cache WHERE k = ?");
const putStmt = db.prepare("INSERT OR REPLACE INTO cache (k, v, t) VALUES (?, ?, ?)");

const PINNED = Number.MAX_SAFE_INTEGER; // recorded fixtures never expire

export function putCache(url, json, pinned = false) {
  putStmt.run(url, JSON.stringify(json), pinned ? PINNED : Date.now());
}

export const misses = new Set();

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
  if (process.env.OFFLINE === "1") {
    misses.add(url);
    throw new CacheMiss(url);
  }
  const res = await fetch(url, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${source} ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  putCache(url, json);
  trace?.add({ source, url, ms: Date.now() - t0, cached: false });
  return json;
}

export function makeTrace() {
  const entries = [];
  return { entries, add: (e) => entries.push(e) };
}
