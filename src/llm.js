// NVIDIA Nemotron on Nebius Token Factory through the OpenAI SDK — see specs/03-agent.md.
import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { es as esName, esPart } from "./i18n.js";

export const MODELS = {
  fast: process.env.MODEL_FAST || "nvidia/Nemotron-3_5-Lightning",
  nano: process.env.MODEL_NANO || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  writer: process.env.MODEL_WRITER || "nvidia/nemotron-3-super-120b-a12b",
};

const key = process.env.NEBIUS_API_KEY?.trim();
export const llmEnabled = !!key;
const client = llmEnabled ? new OpenAI({ baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/", apiKey: key, timeout: Number(process.env.LLM_TIMEOUT_MS) || 25000, maxRetries: 0 }) : null;

// Models sometimes return list items as small objects ({point, detail}); they are flattened to text, and long lists cut.
const text = (x) => (typeof x === "string" ? x : x && typeof x === "object" ? Object.values(x).filter((v) => typeof v === "string" || typeof v === "number").join(": ") : String(x ?? ""));
const strList = (min, max) => z.array(z.any()).transform((a) => a.map(text).filter(Boolean).slice(0, max)).pipe(z.array(z.string()).min(min));
export const ReportSchema = z.object({
  headline: z.string().max(240),
  why: strList(2, 5),
  gap: strList(0, 4).default([]),
  audience: strList(0, 5).default([]),
  actions: strList(2, 4),
  partners: z.array(z.object({ name: z.string(), reason: z.string(), verified: z.boolean().nullable().optional(), source: z.string().nullable().optional() })).max(3).default([]),
  unknowns: strList(3, 3),
});

// Hard daily cap on LLM calls: the demo can never spend more than the credits allow, and one visitor cannot use
// the whole day's budget (per-IP cap; the server runs every request inside withClient).
const CAP = Number(process.env.LLM_DAILY_CAP) || 600;
const CAP_PER_IP = Number(process.env.LLM_DAILY_CAP_PER_IP) || 60;
const usage = { day: "", n: 0, byIp: new Map() };
const als = new AsyncLocalStorage();
export const withClient = (ip, fn) => als.run({ ip }, fn);
// circuit breaker: after 3 failures in a row the model is skipped for 5 minutes (templates answer at once)
const breaker = { fails: 0, until: 0 };
export const llmPaused = () => Date.now() < breaker.until;
function spend() {
  const d = new Date().toISOString().slice(0, 10);
  if (usage.day !== d) Object.assign(usage, { day: d, n: 0, byIp: new Map() });
  if (llmPaused()) throw new Error("model paused after repeated failures");
  if (++usage.n > CAP) throw new Error("daily LLM budget reached");
  const ip = als.getStore()?.ip;
  if (ip) {
    const n = (usage.byIp.get(ip) ?? 0) + 1;
    usage.byIp.set(ip, n);
    if (n > CAP_PER_IP) throw new Error("daily LLM budget for this visitor reached");
  }
}
/** Every model call goes through here: failures feed the breaker, a success resets it. */
async function guarded(fn) {
  try {
    const r = await fn();
    breaker.fails = 0;
    return r;
  } catch (e) {
    if (++breaker.fails >= 3) { breaker.until = Date.now() + 5 * 60 * 1000; breaker.fails = 0; }
    throw e;
  }
}
export const llmUsage = () => ({ day: usage.day, calls: usage.n, cap: CAP });

// Nemotron 3 Nano / Super reason before answering by default; for short JSON jobs we turn thinking off
// (chat_template_kwargs, passed through by Token Factory). Only if the endpoint rejects that parameter do we drop it.
let thinkingKwargs = true;
async function complete(params) {
  if (thinkingKwargs) {
    try {
      return await guarded(() => client.chat.completions.create({ ...params, chat_template_kwargs: { enable_thinking: false } }));
    } catch (e) {
      if (e?.status !== 400 || !/chat_template_kwargs|enable_thinking|unrecognized|unexpected|extra/i.test(String(e?.message))) throw e;
      thinkingKwargs = false;
      spend(); // the retry is a second model call
    }
  }
  return guarded(() => client.chat.completions.create(params));
}

/** Text after the last </think> (templates often open <think> inside the prompt, so only the closing tag shows). */
export const afterThink = (t) => { const s = String(t ?? ""); const i = s.lastIndexOf("</think>"); return (i >= 0 ? s.slice(i + 8) : s).replace(/<think>[\s\S]*$/, "").trim(); };

/** Every balanced {...} object in a text, in order. */
function objectsIn(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { out.push(JSON.parse(text.slice(i, j + 1))); i = j; } catch {}
        break;
      }
    }
  }
  return out;
}

/**
 * The JSON object in a model reply. Tries the answer (after any </think>, without code fences) first and the
 * reasoning only as a last resort; with a schema, returns the first object that passes it.
 */
export function extractJSON(msg, schema) {
  const sources = [afterThink(msg?.content), msg?.reasoning_content].filter((x) => typeof x === "string" && x.trim()).map((x) => x.replace(/```(?:json)?/g, ""));
  for (const src of sources) {
    for (const o of objectsIn(src)) {
      if (!schema) return o;
      const r = schema.safeParse(o);
      if (r.success) return r.data;
    }
  }
  const raw = [msg?.content, msg?.reasoning_content].filter(Boolean).join(" ");
  if (!sources.length || !sources.some((s) => objectsIn(s).length)) throw new Error(`no JSON in the reply (${raw.slice(0, 120).replace(/\s+/g, " ") || "empty"})`);
  // objects were found but none passes the schema: report the first one's problems
  const first = objectsIn(sources[0])[0] ?? objectsIn(sources.at(-1))[0];
  return schema.parse(first);
}

async function chatJSON({ model, system, user, schema, maxTokens = 1200 }) {
  const t0 = Date.now();
  spend();
  const base = { model, temperature: 0.3, max_tokens: maxTokens, response_format: { type: "json_object" } };
  const res = await complete({ ...base, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  const msg = res.choices[0].message;
  let parsed;
  try {
    parsed = extractJSON(msg, schema);
  } catch (e) {
    // one repair round (counts against the daily cap too)
    spend();
    const fix = await complete({
      ...base,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "assistant", content: msg.content ?? "" },
        { role: "user", content: `That reply failed validation: ${String(e.message).slice(0, 400)}. Return only the corrected JSON object with every required key.` },
      ],
    });
    try {
      parsed = extractJSON(fix.choices[0].message, schema);
    } catch (e2) {
      throw new Error(`${String(e2.message).slice(0, 160)} [finish: ${fix.choices[0].finish_reason}; first reply finish: ${res.choices[0].finish_reason}]`);
    }
  }
  return { data: parsed, ms: Date.now() - t0, model, usage: res.usage };
}

/** Nano turns a free-text concept (any language) into short English parts Qloo can match: "gofres y helados" → ["waffles","ice cream"]. */
export async function normalizeConcept(concept) {
  const schema = z.object({ parts: z.array(z.string().min(2).max(40)).min(1).max(3) });
  const system = `Translate a business concept into English and split it ONLY where it names several products joined by "and", "y", "i", "&" or commas. Most concepts are ONE part. Never add a part that is not in the concept. Each part is a short place category or food/drink kind; drop adjectives about quality or style. Return JSON {"parts": [...]}.
Examples: "marisquería" → {"parts":["seafood restaurant"]}; "seafood restaurant" → {"parts":["seafood restaurant"]}; "gofres y helados" → {"parts":["waffles","ice cream"]}; "cafetería de especialidad" → {"parts":["specialty coffee"]}; "librería con café" → {"parts":["bookstore","coffee"]}.`;
  const r = await chatJSON({ model: MODELS.nano, system, user: concept, schema, maxTokens: 400 });
  return { parts: r.data.parts.map((p) => p.toLowerCase().trim()), model: r.model, ms: r.ms };
}

const WRITER_SYSTEM = `You are "Abro Aquí", a location-intelligence advisor for small-business owners. You receive structured signals from Qloo (aggregated taste and offer of an area, never about individuals) and a verdict that code already computed. Explain it like a trusted advisor talking to a bar or shop owner: plain words, no jargon, no decimals in the headline, concrete names and metres.
Rules: never change the verdict; never invent a business, rating or number that is not in the signals; never claim to predict success; refer to people only as "the area" or the customer identities listed. If demand.not_measured_for is not empty, say plainly that taste was only measured for demand.measured_for.
Signals: verdict (level, rule_fired, adjustments, offer: rivals within 400 m / 700 m and share of popular places that already serve it); demand (rank = Qloo affinity_rank around the address 0-1, how much the area likes the concept compared with a wide reference; vs_surroundings = rank inside the 1.5 km circle); best_alternative (a nearby busy block the same rules rate better, with distance_m and its nearest rivals; null if none); competitors_within_700m; supply_by_part; already_served_by; gap; price_gap (direct rivals within 700 m by price level 1-3, written with price_gap.currency repeated, e.g. $, $$, $$$, or as "level 1-3" when currency is null; with the best-rated one; open = no rival there rated 4.5+); area_profile (what the popular places serve, kind, who goes, when).
Respond in {lang}. Return JSON with keys:
headline: one plain sentence with the main reason behind the verdict (the verdict word is shown separately: never write it, and never write colour words like red, amber or green);
why: 2-5 bullets, each citing a number or a name from the signals;
gap: 0-4 bullets on parts of the idea nobody offers nearby (only from gap);
audience: up to 5 bullets on who goes and when, from area_profile.who/when (cite counts like "Foodies: 31 of 50 popular places");
actions: 2-4 concrete actions (a price position from price_gap that is open, naming the rivals that crowd the others; opening hours from area_profile.when; the best_alternative if present);
partners: up to 3 objects {name, reason} chosen ONLY from places named in area_profile.places_named that complement (not compete with) the concept;
unknowns: exactly 3 questions about foot traffic, rent and household income.`;

export async function writeReport(signals, lang = "en") {
  return chatJSON({ model: MODELS.writer, system: WRITER_SYSTEM.replace("{lang}", lang === "es" ? "Spanish" : "English"), user: JSON.stringify(signals), schema: ReportSchema, maxTokens: 2500 });
}

/** "Without Qloo": same writer, no signals. Shows what the LLM invents on its own. */
export async function writeReportWithoutQloo({ concept, address }, lang = "en") {
  const system = `You are a location consultant. The owner asks whether to open a business. You have NO data tools; answer from general knowledge only. Respond in ${lang === "es" ? "Spanish" : "English"}. Return JSON with keys headline, why (2-5), gap (0-4), audience (0-5), actions (2-4), partners (0-3 objects {name, reason}), unknowns (exactly 3).`;
  return chatJSON({ model: MODELS.writer, system, user: `Concept: ${concept}\nAddress: ${address}`, schema: ReportSchema, maxTokens: 2500 });
}

export const LaunchSchema = z.object({
  music: z.array(z.object({ name: z.string(), why: z.string().max(240) })).max(3),
  co_promo: z.array(z.object({ name: z.string(), idea: z.string().max(240) })).max(3),
  brands: z.array(z.object({ name: z.string(), idea: z.string().max(240) })).max(3),
});

const LAUNCH_SYSTEM = `You are "Abro Aquí", planning the opening of a small business. You receive candidates from Qloo's taste graph, learned from the customers of the best-rated places that already serve the concept nearby (seeds), or from the concept itself if there are no seeds: artists (music), brands, and nearby places that are NOT competitors (neighbours, with kind, distance and whether they were found on the web).
Choose, do not invent: every name you return must be copied exactly from the candidates. Prefer neighbours that were verified and are close; skip a brand or artist that obviously clashes with the concept or is a direct competitor; for music, these are famous artists the audience listens to, not acts the shop can hire: propose the opening playlist around them or a local act in that style.
Respond in {lang}, plain words for a shop owner. Return JSON:
music: up to 3 {name, why} (how to use it: the opening playlist, a local act in that style, a night themed on it; never suggest booking the artist);
co_promo: up to 3 {name, idea} (a concrete joint action that fits that neighbour's kind, citing kind and distance: a theatre or music venue → a pre-show offer for ticket holders and opening early on show nights; a hotel → a card at reception; a bar → sending customers to each other at different hours);
brands: up to 3 {name, idea} (sampling, product, a co-branded item); only brands with a plausible link to a small food, drink or neighbourhood business (drinks, food, local lifestyle); skip software, fashion or anything a small shop could not realistically approach. Ideas are one or two plain sentences a shop owner can act on; never start with numbers or affinity scores.
The headline, the poster zones and the week-by-week plan are written by code from your choices; do not write them.`;

export async function writeLaunch(input, lang = "en") {
  return chatJSON({ model: MODELS.writer, system: LAUNCH_SYSTEM.replace("{lang}", lang === "es" ? "Spanish" : "English"), user: JSON.stringify(input), schema: LaunchSchema, maxTokens: 2000 });
}

/** Template report when the LLM is unavailable: the Qloo demo must survive an LLM outage. Plain words, EN or ES. */
export function templateReport(sig, lang = "en") {
  const es = lang === "es";
  const L = (en, sp) => (es ? sp : en);
  const v = sig.verdict;
  const o = v.offer ?? { c400: 0, c700: 0, share: null };
  const d = sig.demand ?? {};
  const where = sig.address.split(",").slice(0, 2).join(",").trim();
  const N = (x) => (es ? esName(x) : x);
  const c = es ? `«${sig.concept_parts.map((p) => esPart(p.part)).join(" y ")}»` : sig.concept;
  const how = d.rank == null ? "" : d.rank >= 0.9 ? L("a lot", "mucho") : d.rank >= 0.75 ? L("fairly well", "bastante") : L("little", "poco");
  const top = sig.competitors_within_700m[0];
  const topTxt = top ? L(`${top.name} is ${top.distance_m} m away`, `${top.name} está a ${top.distance_m} m`) : "";
  const unmeasured = d.not_measured_for?.length
    ? L(` I could only measure taste for "${d.measured_for.join(", ")}": Qloo has no data on "${d.not_measured_for.join(", ")}" here.`, ` Solo he podido medir el gusto por «${d.measured_for.map(esPart).join(", ")}»: Qloo no tiene datos de «${d.not_measured_for.map(esPart).join(", ")}» aquí.`)
    : "";
  const head = {
    "well-served": L(`The area likes ${c} ${how}, but it is already well served: ${topTxt}${o.c700 > 1 ? ` and there are ${o.c700 - 1} more within 700 m` : ""}.`, `A la zona le gusta ${how} ${c}, pero ya está bien servida: ${topTxt}${o.c700 > 1 ? ` y hay ${o.c700 - 1} más a menos de 700 m` : ""}.`),
    mixed: L(`The area likes ${c} ${how}, with ${o.c700} rivals within 700 m: no clear gap, no saturation.`, `A la zona le gusta ${how} ${c}, con ${o.c700} rivales a menos de 700 m: ni hueco claro ni saturación.`),
    "weak-demand": L(`The taste of the area around ${where} leans away from ${c}.`, `El gusto de la zona de ${where} va por otro lado: ${c} no encaja.`),
    "appetite-without-offer": L(`The area likes ${c} a lot and almost nobody offers it within 700 m.`, `A la zona le gusta mucho ${c} y casi nadie lo ofrece a menos de 700 m.`),
    "no-data": L(`Not enough Qloo data around ${where} to judge ${c}.`, `No hay datos suficientes de Qloo en ${where} para juzgar ${c}.`),
  };
  const comps = sig.competitors_within_700m.slice(0, 3).map((x) => `${x.name} (${x.rating == null ? "–" : es ? String(x.rating).replace(".", ",") : x.rating}★, ${x.distance_m} m)`).join(", ");
  const EUR = (n) => (sig.price_gap?.currency ? sig.price_gap.currency.repeat(n) : L(`level ${n}`, `nivel ${n}`));
  const pg = sig.price_gap;
  const openL = pg?.levels.filter((l) => l.open && l.level <= 3) ?? [];
  const crowded = pg?.levels.filter((l) => !l.open) ?? [];
  const priceAction = pg && openL.length && crowded.length
    ? L(`Price position: ${crowded.map((l) => `${EUR(l.level)} is taken (${l.best.name} ${l.best.rating}★)`).join(", ")}; nobody rated 4.5+ at ${openL.map((l) => `${EUR(l.level)}${l.rivals ? ` (best: ${l.best?.name ?? "–"} ${l.best?.rating ?? ""}★)` : " (no rival)"}`).join(", ")}. Worth a look if your costs fit that price.`,
        `Posición de precio: ${crowded.map((l) => `${EUR(l.level)} está cogido (${l.best.name} ${String(l.best.rating).replace(".", ",")}★)`).join(", ")}; nadie con 4,5+ en ${openL.map((l) => `${EUR(l.level)}${l.rivals ? ` (el mejor: ${l.best?.name ?? "–"} ${String(l.best?.rating ?? "").replace(".", ",")}★)` : " (sin rival)"}`).join(", ")}. Vale la pena estudiarlo si tus costes encajan en ese precio.`)
    : null;
  const share = sig.already_served_by.filter((x) => x.places > 0).map((x) => L(`${x.places} of the ${x.of} most popular places within 500 m already serve ${x.part}.`, `${x.places} de los ${x.of} locales más populares a 500 m ya ${x.places === 1 ? "sirve" : "sirven"} ${esPart(x.part)}.`));
  const b = sig.best_alternative;
  const alt = b ? [L(`Look ${b.distance_m} m away (green ring): the area likes it even more there and has ${b.c700} rivals within 700 m instead of ${o.c700}.`, `Mira a ${b.distance_m} m (círculo verde): allí gusta aún más y hay ${b.c700} rivales a 700 m en lugar de ${o.c700}.`)] : [];
  const when = sig.area_profile.when.slice(0, 2).map((w) => N(w.name).toLowerCase()).join(L(" and ", " y "));
  return {
    headline: (head[v.rule_code] ?? head.mixed) + unmeasured,
    why: [es ? v.rule_es ?? v.rule_fired : v.rule_fired, ...(es ? v.adjustments_es ?? v.adjustments : v.adjustments), ...share, comps ? L(`Closest direct competitors: ${comps}.`, `Competidores directos más cercanos: ${comps}.`) : L("No direct competitor within 700 m.", "Ningún competidor directo a menos de 700 m.")].slice(0, 5),
    gap: sig.gap.map((g) => L(`Nobody within 700 m offers ${g}.`, `Nadie a menos de 700 m ofrece ${g}.`)),
    audience: [...sig.area_profile.who.slice(0, 4).map((w) => L(`${w.name}: ${w.count} of the ${sig.area_profile.places} most popular places nearby cater to them`, `${N(w.name)}: ${w.count} de los ${sig.area_profile.places} locales más populares`)), ...(when ? [L(`Busiest: ${when}`, `Más actividad: ${when}`)] : [])],
    actions: [...alt, priceAction ?? (top ? L(`Differentiate from ${top.name} on format and price, not on the same product.`, `Diferénciate de ${top.name} en formato y precio, no con el mismo producto.`) : L("Be the first: own the category name in local search before anyone else does.", "Sé el primero: hazte con el nombre de la categoría en las búsquedas locales.")), when ? L(`Open when the area is busiest for places like yours: ${when}.`, `Abre cuando la zona tiene más actividad: ${when}.`) : L("Test opening hours for two weeks before fixing them.", "Prueba horarios dos semanas antes de fijarlos.")].slice(0, 4),
    partners: [],
    unknowns: es ? ["Tráfico de gente delante de la puerta (cuéntalo: un día laborable a las 13:00 y un sábado a las 18:00)", "Alquiler y licencia frente al ticket medio que esperas", "Renta de los hogares de la zona (Qloo mide gusto, no capacidad de gasto)"] : v.unknowns,
  };
}

/** Chat with tools (Lightning). tools: {name: {description, parameters, run}} */
export async function chatWithTools({ messages, tools, maxRounds = 4, maxTokens = 900, lang = "en", maxCalls = 6 }) {
  const toolDefs = Object.entries(tools).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
  const calls = [];
  for (let i = 0; i < maxRounds; i++) {
    spend();
    const t0 = Date.now();
    // once the tool budget is used, the model must answer with what it has
    const toolChoice = calls.length >= maxCalls || i === maxRounds - 1 ? "none" : "auto";
    const res = await guarded(() => client.chat.completions.create({ model: MODELS.fast, messages, tools: toolDefs, tool_choice: toolChoice, temperature: 0.3, max_tokens: maxTokens }));
    const think_ms = Date.now() - t0;
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      const text = afterThink(msg.content);
      if (!text) throw new Error("the model returned an empty answer");
      return { text, calls, model: MODELS.fast };
    }
    const allowed = Math.max(0, maxCalls - calls.length);
    for (const [k, call] of msg.tool_calls.entries()) {
      if (k >= allowed) {
        // every tool call needs an answer in the conversation, even the ones over budget
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: "tool budget used: answer with what you have" }) });
        continue;
      }
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
      let result;
      const t1 = Date.now();
      try {
        const tool = tools[call.function.name];
        if (!tool) throw new Error(`unknown tool ${call.function.name}`);
        result = await tool.run(args);
      } catch (e) { result = { error: String(e.message).slice(0, 200) }; }
      calls.push({ name: call.function.name, args, result, round: i + 1, think_ms, ms: Date.now() - t1 });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  throw new Error(lang === "es" ? "el modelo no terminó en las rondas permitidas" : "the model did not finish within the allowed rounds");
}
