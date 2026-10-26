// Qloo client: key stays server-side; every call goes through the shared cache and the per-request trace.
import { getJSON } from "./http.js";

const BASE = process.env.QLOO_API_URL || "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY || "";

export function qlooUrl(path, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

export function qloo(path, params, trace) {
  return getJSON(qlooUrl(path, params), { headers: { "X-Api-Key": KEY }, source: "qloo", trace });
}

// Qloo expects WKT with longitude first.
export const point = (lat, lon) => `POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`;
