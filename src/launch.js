// Launch plan — "where do I announce the opening?" See specs/04-launch.md.
// Seeds = the places that already succeed with the concept nearby (best-rated rivals). Qloo's taste graph answers
// what their customers also like in other domains: music for the opening, brands for a collaboration, and nearby
// places that are not competitors (co-promotion). Poster zones come from the concept's own heat map.
import { qloo, point } from "./qloo.js";
import { makeTrace } from "./http.js";
import { haversine, verifyBusiness, streetAt } from "./tools.js";
import { llmEnabled, writeLaunch } from "./llm.js";

export const cityOf = (display) =>
  display.split(",").map((x) => x.trim()).find((x) => /barcelona|new york|brooklyn|manhattan|london|san francisco|madrid|paris|chicago|los angeles/i.test(x)) ??
  display.split(",").slice(-4, -3)[0]?.trim() ?? "";

/** The rivals whose audience we learn from: rated, with a Qloo id, best first (max 3). */
export function pickSeeds(competitors, n = 3) {
  return competitors
    .filter((c) => c.id && c.rating != null)
    .sort((a, b) => b.rating - a.rating || (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9))
    .slice(0, n);
}

/** Qloo signal params: the seed places if we have their ids, otherwise the concept tag. */
export function signalParams(seeds, tag) {
  if (seeds.length) return { "signal.interests.entities": seeds.map((s) => s.id).join(",") };
  return tag ? { "signal.interests.tags": tag } : null;
}

const SENSITIVE = /lgbt|gay|lesbian|queer|church|mosque|synagogue|temple|religio|clinic|hospital|pharmacy|school|kindergarten|funeral|police|embassy|bank/i;

/**
 * Nearby places worth a co-promotion: affine to the seeds, not competitors, open, within reach.
 * A place is a competitor if it carries the concept's tag, shares a concept word in its tags, or is already in the rival list.
 */
export function pickNeighbours(entities, { lat, lon, rivalNames = [], tagIds = [], words = [], max = 6 }) {
  const rivals = new Set(rivalNames.map((n) => n.toLowerCase()));
  const ids = new Set(tagIds.filter(Boolean));
  const out = [];
  for (const e of entities) {
    if (!e?.name || rivals.has(e.name.toLowerCase()) || e.properties?.is_closed) continue;
    const tags = e.tags ?? [];
    if (tags.some((t) => ids.has(t.id))) continue;
    const names = tags.map((t) => String(t.name ?? "").toLowerCase());
    if (words.length && names.some((nm) => words.some((w) => nm.split(/[^a-z0-9]+/).includes(w)))) continue;
    const kind = tags.find((t) => t.type === "urn:tag:category:place" && !/^(place|restaurant|point of interest|establishment)$/i.test(t.name))?.name ?? null;
    if (SENSITIVE.test(`${kind ?? ""} ${e.name}`)) continue;
    const g = e.location ?? {};
    out.push({
      name: e.name,
      kind,
      rating: e.properties?.business_rating != null ? Math.round(e.properties.business_rating * 10) / 10 : null,
      distance_m: g.lat != null ? haversine(lat, lon, g.lat, g.lon) : null,
      lat: g.lat ?? null,
      lon: g.lon ?? null,
      affinity: e.query?.affinity ?? null,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Poster / flyer zones: the busiest blocks where the area likes the concept most, at least `gap` metres apart,
 * excluding the block of the shop itself. score = affinity_rank × activity (popularity rank).
 */
export function posterZones(cells, { lat, lon }, { n = 3, gap = 300, maxDist = 900, minActivity = 0.6 } = {}) {
  const cand = cells
    .map((c) => ({ ...c, distance_m: haversine(lat, lon, c.lat, c.lon) }))
    .filter((c) => c.distance_m >= 120 && c.distance_m <= maxDist && c.popularity >= minActivity && c.affinity_rank != null)
    .map((c) => ({ ...c, score: Math.round(c.affinity_rank * c.popularity * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.distance_m - b.distance_m);
  const picked = [];
  for (const c of cand) {
    if (picked.every((p) => haversine(p.lat, p.lon, c.lat, c.lon) >= gap)) picked.push(c);
    if (picked.length >= n) break;
  }
  return picked.map(({ lat, lon, distance_m, affinity_rank, popularity, score }) => ({ lat, lon, distance_m, demand: affinity_rank, activity: popularity, score }));
}

const entOut = (e) => ({ name: e.name, affinity: e.query?.affinity != null ? Math.round(e.query.affinity * 1000) / 1000 : null, kind: (e.tags ?? []).find((t) => /genre/.test(t.type ?? ""))?.name ?? null });

/** Candidates from Qloo (4 calls, 2 at a time to stay under the rate limit). */
export async function launchCandidates(ctx, trace, { at } = {}) {
  const spot = at ?? { lat: ctx.geo.lat, lon: ctx.geo.lon };
  const main = ctx.resolved.find((p) => p.heatmap_tag) ?? ctx.resolved[0];
  const seeds = pickSeeds(ctx.competitors ?? []);
  const sig = signalParams(seeds, main?.heatmap_tag);
  const loc = { "signal.location": point(spot.lat, spot.lon), "signal.location.radius": 3000 };
  const get = (type, extra = {}, take = 10) =>
    sig ? qloo("/v2/insights", { "filter.type": type, ...sig, ...extra, take }, trace).then((d) => d?.results?.entities ?? []).catch((e) => { trace.add({ source: "qloo", url: `launch:${type}`, ms: 0, cached: false, error: String(e.message).slice(0, 80) }); return []; }) : Promise.resolve([]);

  const [artists, brands] = await Promise.all([get("urn:entity:artist", loc), get("urn:entity:brand", loc, 15)]);
  const [places] = await Promise.all([
    get("urn:entity:place", { "filter.location": point(spot.lat, spot.lon), "filter.location.radius": 600 }, 40),
  ]);

  const words = ctx.resolved.flatMap((p) => p.part.split(" ")).filter((w) => w.length > 3 && !/restaurant|shop|store|place|house/.test(w));
  const tagIds = ctx.resolved.flatMap((p) => [p.competitor_tag, p.heatmap_tag, ...(p.comp_candidates ?? [])]);
  const rivalNames = (ctx.competitors ?? []).map((c) => c.name);
  const neighbours = pickNeighbours(places, { ...spot, rivalNames, tagIds, words });
  const rivalSet = new Set(rivalNames.map((n) => n.toLowerCase()));
  return {
    spot,
    seeds: seeds.map(({ name, rating, distance_m }) => ({ name, rating, distance_m })),
    signal: seeds.length ? "rivals" : sig ? "concept" : "none",
    music: artists.slice(0, 8).map(entOut),
    brands: brands.filter((b) => !rivalSet.has(b.name.toLowerCase())).slice(0, 10).map(entOut),
    neighbours,
    posters: posterZones(ctx.heatmap?.cells ?? [], spot),
  };
}

/** Template plan when the model is not available: same candidates, fixed choices. */
export function templateLaunch(c, ctx, lang = "en") {
  const es = lang === "es";
  const L = (en, sp) => (es ? sp : en);
  const from = c.seeds.length ? c.seeds.map((s) => s.name).join(", ") : L(`people who like ${ctx.concept} here`, `quien disfruta de ${ctx.concept} aquí`);
  const n = c.neighbours.slice(0, 3);
  return {
    headline: c.seeds.length
      ? L(`Built from what the customers of ${from} also like.`, `Hecho con lo que también les gusta a los clientes de ${from}.`)
      : L(`Built from what ${from} also like.`, `Hecho con lo que también le gusta a ${from}.`),
    music: c.music.slice(0, 3).map((m) => ({ name: m.name, why: L("high affinity with the same audience: use it for the opening playlist or a small live set", "afinidad alta con el mismo público: para la playlist de la inauguración o un directo pequeño") })),
    co_promo: n.map((p) => ({ name: p.name, idea: L(`${p.kind ?? "neighbour"} ${p.distance_m ?? "?"} m away, same audience, does not compete: swap flyers or a joint discount in the opening week`, `${p.kind ?? "vecino"} a ${p.distance_m ?? "?"} m, mismo público y no compite: intercambiar flyers o un descuento conjunto la semana de apertura`) })),
    brands: c.brands.slice(0, 2).map((b) => ({ name: b.name, idea: L("ask for product or sampling for the opening night: their fans overlap with yours", "pedir producto o degustación para la noche de apertura: sus fans se solapan con los tuyos") })),
    posters: c.posters.map((z) => ({ where: z.street ?? `${z.lat.toFixed(4)}, ${z.lon.toFixed(4)}`, why: L(`${z.street ? `${z.street}, ` : ""}${z.distance_m} m away: taste rank ${z.demand.toFixed(2)} and busier than ${Math.round(z.activity * 100)} % of the blocks around`, `${z.street ? `${z.street}, ` : ""}a ${z.distance_m} m: gusto ${z.demand.toFixed(2).replace(".", ",")} y más actividad que el ${Math.round(z.activity * 100)} % de las manzanas de alrededor`) })),
    weeks: [
      L("Week −2: agree the co-promotion with the neighbours above and book the music.", "Semana −2: cerrar la co-promoción con los vecinos de arriba y reservar la música."),
      L("Week −1: posters and flyers in the zones on the map; ask the brands for sampling.", "Semana −1: carteles y flyers en las zonas del mapa; pedir degustación a las marcas."),
      L("Opening week: opening night with the playlist and the brand sampling; joint discount with the neighbours.", "Semana de apertura: noche de inauguración con la playlist y la degustación; descuento conjunto con los vecinos."),
      L("Week +1: count who came from each channel (ask at the till) and keep the one that worked.", "Semana +1: contar quién vino por cada canal (preguntar en caja) y quedarse con el que funcionó."),
    ],
  };
}

/** Keep only names that came from the candidates: the model chooses, it never invents. */
export function keepKnown(plan, c) {
  const has = (list) => { const s = new Set(list.map((x) => x.name.toLowerCase())); return (x) => s.has(String(x.name ?? "").toLowerCase()); };
  return {
    ...plan,
    music: (plan.music ?? []).filter(has(c.music)),
    co_promo: (plan.co_promo ?? []).filter(has(c.neighbours)),
    brands: (plan.brands ?? []).filter(has(c.brands)),
  };
}

export async function launchPlan({ ctx, lang = "en", at }) {
  const trace = makeTrace();
  const t0 = Date.now();
  const c = await launchCandidates(ctx, trace, { at });
  const city = cityOf(ctx.address);
  // street names for the poster zones (OpenStreetMap allows ~1 request per second; cached)
  const streetsP = (async () => {
    for (const z of c.posters) {
      z.street = await streetAt(z, trace).catch(() => null);
      if (!process.env.OFFLINE && !trace.entries.at(-1)?.cached) await new Promise((r) => setTimeout(r, 1100));
    }
  })();
  // check on the live web that the co-promotion neighbours exist (top 4), drop those that are not found
  const checks = await Promise.all(c.neighbours.slice(0, 4).map((p) => verifyBusiness({ name: p.name, city }, trace).catch(() => ({ exists: null }))));
  c.neighbours = c.neighbours.map((p, i) => ({ ...p, verified: checks[i]?.exists ?? null, source: checks[i]?.url ?? null })).filter((p) => p.verified !== false);

  let plan, meta = { model: "template" };
  if (llmEnabled && (c.music.length || c.neighbours.length || c.brands.length)) {
    try {
      const r = await writeLaunch({ concept: ctx.concept, address: ctx.address, verdict: ctx.verdict.level, candidates: c }, lang);
      plan = keepKnown(r.data, c);
      meta = { model: r.model, ms: r.ms };
    } catch (e) {
      plan = templateLaunch(c, ctx, lang);
      meta = { model: "failed → template", error: String(e.message).slice(0, 160) };
    }
  } else plan = templateLaunch(c, ctx, lang);
  await streetsP;
  // the model may drop everything it was given; never return an empty plan when candidates exist
  const tpl = templateLaunch(c, ctx, lang);
  for (const k of ["music", "co_promo", "brands", "weeks"]) if (!plan[k]?.length) plan[k] = tpl[k];
  plan.posters = tpl.posters; // coordinates come from the heat map, never from the model
  return { plan, candidates: c, meta, trace: trace.entries, total_ms: Date.now() - t0 };
}
