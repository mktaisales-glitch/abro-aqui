// Qloo client: server-side key, SQLite cache (24 h), per-request trace.
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.QLOO_API_URL || "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;
const TTL_MS = 24 * 3600 * 1000;

fs.mkdirSync("data", { recursive: true });
const db = new Database("data/cache.sqlite");
db.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, t INTEGER)");
const getStmt = db.prepare("SELECT v, t FROM cache WHERE k = ?");
const putStmt = db.prepare("INSERT OR REPLACE INTO cache (k, v, t) VALUES (?, ?, ?)");

export function makeTrace() {
  const entries = [];
  return {
    entries,
    add(e) {
      entries.push(e);
    },
  };
}

export async function qloo(path, params = {}, trace) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const key = url.toString();
  const t0 = Date.now();
  const hit = getStmt.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) {
    trace?.add({ source: "qloo", url: key, ms: Date.now() - t0, cached: true });
    return JSON.parse(hit.v);
  }
  const res = await fetch(key, { headers: { "X-Api-Key": KEY } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Qloo ${res.status} on ${path}: ${JSON.stringify(json).slice(0, 200)}`);
  putStmt.run(key, JSON.stringify(json), Date.now());
  trace?.add({ source: "qloo", url: key, ms: Date.now() - t0, cached: false });
  return json;
}

export const point = (lat, lon) => `POINT(${lon} ${lat})`;
