// Qloo client: key stays server-side; every call goes through the shared cache and the per-request trace.
import { getJSON } from "./http.js";

const BASE = process.env.QLOO_API_URL || "https://hackathon.api.qloo.com";
const KEY = (process.env.QLOO_API_KEY || "").trim();

export function qlooUrl(path, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

// The hackathon key allows only a few calls at once: at most MAX_PARALLEL in flight, and a 429 is retried
// with backoff (0.8 s, 1.6 s, 3.2 s) before it becomes an error.
const MAX_PARALLEL = Number(process.env.QLOO_PARALLEL) || 4;
let active = 0;
const queue = [];
const acquire = () => (active < MAX_PARALLEL ? (active++, Promise.resolve()) : new Promise((r) => queue.push(r)));
const release = () => { const next = queue.shift(); if (next) next(); else active--; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function qloo(path, params, trace) {
  const url = qlooUrl(path, params);
  for (let attempt = 0; ; attempt++) {
    await acquire();
    try {
      return await getJSON(url, { headers: { "X-Api-Key": KEY }, source: "qloo", trace });
    } catch (e) {
      if (!/ 429:/.test(e.message) || attempt >= 3) throw e;
    } finally {
      release();
    }
    await sleep(800 * 2 ** attempt);
  }
}

// Qloo expects WKT with longitude first.
export const point = (lat, lon) => `POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`;
