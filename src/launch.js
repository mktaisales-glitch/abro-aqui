// Launch plan — "where do I announce the opening?" See specs/04-launch.md.
// Seeds = the places that already succeed with the concept nearby (best-rated rivals). Qloo's taste graph answers
// what their customers also like in other domains: music for the opening, brands for a collaboration, and nearby
// places that are not competitors (co-promotion). Poster zones come from the concept's own heat map.
import { qloo, point } from "./qloo.js";
import { makeTrace } from "./http.js";
import { haversine, verifyBusiness, streetAt, singular } from "./tools.js";
import { llmEnabled, writeLaunch } from "./llm.js";
import { esPart } from "./i18n.js";

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

// Settings where a commercial co-promotion is out of place (care, children, grief, public authority). Never identity:
// a place is never excluded for who its customers are.
const NOT_FOR_PROMO = /clinic|hospital|pharmacy|dentist|school|kindergarten|nursery|funeral|cemetery|police|embassy|consulate|courthouse/i;

/**
 * Nearby places worth a co-promotion: affine to the seeds, not competitors, open, within reach.
 * A place is a competitor if it carries the concept's tag, shares a concept word in its tags, or is already in the rival list.
 */
export function pickNeighbours(entities, { lat, lon, rivalNames = [], tagIds = [], words = [], excludeKinds = null, max = 6 }) {
  const rivals = new Set(rivalNames.map((n) => n.toLowerCase()));
  const ids = new Set(tagIds.filter(Boolean));
  const out = [];
  for (const e of entities) {
    if (!e?.name || rivals.has(e.name.toLowerCase()) || e.properties?.is_closed) continue;
    const tags = e.tags ?? [];
    if (tags.some((t) => ids.has(t.id))) continue;
    const names = tags.map((t) => String(t.name ?? "").toLowerCase());
    if (words.length && names.some((nm) => words.some((w) => nm.split(/[^a-z0-9]+/).map(singular).includes(w)))) continue;
    const kind = tags.find((t) => t.type === "urn:tag:category:place" && !/^(place|restaurant|point of interest|establishment)$/i.test(t.name))?.name ?? null;
    if (NOT_FOR_PROMO.test(`${kind ?? ""} ${e.name}`)) continue;
    if (excludeKinds && kind && excludeKinds.test(kind)) continue;
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
export function posterZones(cells, { lat, lon }, { n = 3, gap = 300, maxDist = 700, minActivity = 0.6 } = {}) {
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

/** Candidates from Qloo: 3 calls in parallel (well under the rate limit). */
export async function launchCandidates(ctx, trace, { at } = {}) {
  const spot = at ?? { lat: ctx.geo.lat, lon: ctx.geo.lon };
  const main = ctx.resolved.find((p) => p.heatmap_tag) ?? ctx.resolved[0];
  const seeds = pickSeeds(ctx.competitors ?? []);
  const sig = signalParams(seeds, main?.heatmap_tag);
  // No signal.location on artists and brands: at street level it pulls generic luxury brands (see FEEDBACK.md);
  // the seeds are already local places, so their audience carries the locality.
  const get = (type, extra = {}, take = 10) =>
    sig ? qloo("/v2/insights", { "filter.type": type, ...sig, ...extra, take }, trace).then((d) => d?.results?.entities ?? []).catch((e) => { trace.add({ source: "qloo", url: `launch:${type}`, ms: 0, cached: false, error: String(e.message).slice(0, 80) }); return []; }) : Promise.resolve([]);

  const [artists, brands, places] = await Promise.all([
    get("urn:entity:artist"),
    get("urn:entity:brand", {}, 15),
    get("urn:entity:place", { "filter.location": point(spot.lat, spot.lon), "filter.location.radius": 600 }, 40),
  ]);

  const words = ctx.resolved.flatMap((p) => p.part.split(" ")).filter((w) => w.length > 3 && !/restaurant|shop|store|place|house/.test(w)).map(singular);
  // a restaurant's neighbours to team up with are not other restaurants (they compete for the same meal)
  const isRestaurant = ctx.resolved.some((p) => /restaurant/.test(`${p.part} ${p.heatmap_tag ?? ""} ${p.competitor_tag ?? ""}`));
  const tagIds = ctx.resolved.flatMap((p) => [p.competitor_tag, p.heatmap_tag, ...(p.comp_candidates ?? [])]);
  const rivalNames = (ctx.competitors ?? []).map((c) => c.name);
  const neighbours = pickNeighbours(places, { ...spot, rivalNames, tagIds, words, excludeKinds: isRestaurant ? /restaurant|steakhouse|bistro|diner|eatery/i : null });
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

const list = (xs, es) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${xs.at(-1)}`);

/** Headline, poster texts and the 4 weeks are always written by code from the names that survived: nothing invented. */
export function composeFixed(plan, c, ctx, lang = "en") {
  const es = lang === "es";
  const L = (en, sp) => (es ? sp : en);
  const seeds = c.seeds.map((s) => s.name);
  const headline = seeds.length
    ? L(`Learned from what the customers of ${list(seeds, es)} (the best-rated rivals nearby) also like.`, `Aprendido de lo que también les gusta a los clientes de ${list(seeds, es)} (los rivales mejor valorados cerca).`)
    : L(`Learned from what people who like ${ctx.concept} around here also like (no rated rival to learn from).`, `Aprendido de lo que también le gusta a quien disfruta de «${ctx.resolved.map((p) => esPart(p.part)).join(" y ")}» por aquí (no hay rival valorado del que aprender).`);
  const posters = c.posters.map((z) => {
    const top = Math.max(1, Math.round((1 - z.activity) * 100));
    return { where: z.street ?? `${z.lat.toFixed(4)}, ${z.lon.toFixed(4)}`, why: L(`${z.street ? `${z.street}, ` : ""}${z.distance_m} m away: taste rank ${z.demand.toFixed(2)}, among the ${top} % busiest blocks around`, `${z.street ? `${z.street}, ` : ""}a ${z.distance_m} m: gusto ${z.demand.toFixed(2).replace(".", ",")}, entre el ${top} % de manzanas con más actividad`) };
  });
  const nb = plan.co_promo.map((x) => x.name), mu = plan.music.map((x) => x.name), br = plan.brands.map((x) => x.name);
  const streets = c.posters.map((z) => z.street).filter(Boolean);
  const w2 = [nb.length && L(`agree a joint action with ${list(nb, es)}`, `cerrar una acción conjunta con ${list(nb, es)}`), mu.length && L(`build the opening playlist around ${list(mu, es)} and look for a local act in that style`, `armar la playlist de la inauguración alrededor de ${list(mu, es)} y buscar un grupo local de ese estilo`)].filter(Boolean);
  const w1 = [posters.length && L(`posters and flyers on ${streets.length ? list(streets, es) : "the purple zones on the map"}`, `carteles y flyers en ${streets.length ? list(streets, es) : "las zonas moradas del mapa"}`), br.length && L(`ask ${list(br, es)} for product or sampling`, `pedir producto o degustación a ${list(br, es)}`)].filter(Boolean);
  const w0 = [L("opening night", "noche de inauguración"), mu.length && L("with the playlist", "con la playlist"), br.length && L(`and the ${br[0]} sampling`, `y la degustación de ${br[0]}`), nb.length && L(`; joint offer with ${nb[0]}`, `; oferta conjunta con ${nb[0]}`)].filter(Boolean).join(" ").replace(" ;", ";");
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const weeks = [
    w2.length ? `${L("Week −2", "Semana −2")}: ${w2.join("; ")}.` : L("Week −2: pick the opening date and tell the street.", "Semana −2: fijar la fecha de apertura y contarlo en la calle."),
    w1.length ? `${L("Week −1", "Semana −1")}: ${w1.join("; ")}.` : L("Week −1: flyers around the shop.", "Semana −1: flyers alrededor del local."),
    `${L("Opening week", "Semana de apertura")}: ${cap(w0)}.`,
    L("Week +1: ask every customer at the till how they heard about you, and keep the channel that brought people.", "Semana +1: preguntar en caja a cada cliente cómo se enteró y quedarse con el canal que trajo gente."),
  ];
  return { headline, posters, weeks };
}

/** A concrete joint action by kind of neighbour (theatre → pre-show offer, hotel → reception card…). */
export function coPromoIdea(p, lang = "en") {
  const L = (en, sp) => (lang === "es" ? sp : en);
  const k = String(p.kind ?? "").toLowerCase();
  const at = L(`${p.kind ?? "neighbour"}, ${p.distance_m ?? "?"} m away`, `${p.kind ?? "vecino"} a ${p.distance_m ?? "?"} m`);
  if (/theat|cinema|concert|music|venue|auditorium|opera/.test(k)) return L(`${at}: a pre-show offer for anyone who shows a ticket, and open early on show nights`, `${at}: oferta antes de la función para quien enseñe la entrada, y abrir antes los días de función`);
  if (/hotel|hostel|guest/.test(k)) return L(`${at}: a recommendation card at reception and a welcome offer for their guests`, `${at}: una tarjeta de recomendación en recepción y una oferta de bienvenida para sus huéspedes`);
  if (/bar|pub|club|cocktail|wine/.test(k)) return L(`${at}: send your late customers there and ask them to send you their early crowd; a shared flyer`, `${at}: enviarles tus clientes de última hora y que te manden su público de primera hora; un flyer compartido`);
  if (/gym|fitness|yoga|sport/.test(k)) return L(`${at}: a post-workout offer for their members`, `${at}: una oferta para sus socios después de entrenar`);
  if (/book|gallery|museum|record|art/.test(k)) return L(`${at}: a joint evening event in the opening week`, `${at}: un evento conjunto de tarde la semana de apertura`);
  return L(`${at}, same audience, does not compete: swap flyers or a joint discount in the opening week`, `${at}, mismo público y no compite: intercambiar flyers o un descuento conjunto la semana de apertura`);
}

/** Template choices when the model is not available: same candidates, fixed choices. */
export function templateLaunch(c, ctx, lang = "en") {
  const L = (en, sp) => (lang === "es" ? sp : en);
  return {
    music: c.music.slice(0, 3).map((m) => ({ name: m.name, why: L("the same audience listens to it: build the opening playlist around it and look for a local act in that style", "el mismo público lo escucha: arma la playlist de la inauguración a su alrededor y busca un grupo local de ese estilo") })),
    co_promo: c.neighbours.slice(0, 3).map((p) => ({ name: p.name, idea: coPromoIdea(p, lang) })),
    brands: c.brands.slice(0, 2).map((b) => ({ name: b.name, idea: L("ask for product or sampling for the opening night: their fans overlap with yours", "pedir producto o degustación para la noche de apertura: sus fans se solapan con los tuyos") })),
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
  for (const k of ["music", "co_promo", "brands"]) if (!plan[k]?.length) plan[k] = tpl[k];
  // headline, poster zones and weeks are composed by code from the surviving names (the model never writes them)
  plan = { music: plan.music, co_promo: plan.co_promo, brands: plan.brands, ...composeFixed(plan, c, ctx, lang) };
  return { plan, candidates: c, meta, trace: trace.entries, total_ms: Date.now() - t0 };
}
