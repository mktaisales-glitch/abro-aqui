// NVIDIA Nemotron on Nebius Token Factory through the OpenAI SDK — see specs/03-agent.md.
import OpenAI from "openai";
import { z } from "zod";

export const MODELS = {
  fast: process.env.MODEL_FAST || "nvidia/Nemotron-3_5-Lightning",
  nano: process.env.MODEL_NANO || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  writer: process.env.MODEL_WRITER || "nvidia/nemotron-3-super-120b-a12b",
};

const key = process.env.NEBIUS_API_KEY;
export const llmEnabled = !!key;
const client = llmEnabled ? new OpenAI({ baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/", apiKey: key, timeout: Number(process.env.LLM_TIMEOUT_MS) || 25000, maxRetries: 1 }) : null;

export const ReportSchema = z.object({
  headline: z.string().max(200),
  why: z.array(z.string()).min(2).max(5),
  gap: z.array(z.string()).max(4),
  audience: z.array(z.string()).max(5),
  actions: z.array(z.string()).min(2).max(4),
  partners: z.array(z.object({ name: z.string(), reason: z.string(), verified: z.boolean().nullable().optional(), source: z.string().nullable().optional() })).max(3),
  unknowns: z.array(z.string()).length(3),
});

// Hard daily cap on LLM calls: the demo can never spend more than the credits allow.
const CAP = Number(process.env.LLM_DAILY_CAP) || 600;
const usage = { day: "", n: 0 };
function spend() {
  const d = new Date().toISOString().slice(0, 10);
  if (usage.day !== d) Object.assign(usage, { day: d, n: 0 });
  if (++usage.n > CAP) throw new Error("daily LLM budget reached");
}
export const llmUsage = () => ({ day: usage.day, calls: usage.n, cap: CAP });

async function chatJSON({ model, system, user, schema, maxTokens = 1200 }) {
  const t0 = Date.now();
  spend();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
  const text = res.choices[0].message.content ?? "{}";
  let parsed;
  try {
    parsed = schema.parse(JSON.parse(text));
  } catch (e) {
    // one repair round (counts against the daily cap too)
    spend();
    const fix = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "assistant", content: text },
        { role: "user", content: `That JSON failed validation: ${String(e.message).slice(0, 400)}. Return only corrected JSON.` },
      ],
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });
    parsed = schema.parse(JSON.parse(fix.choices[0].message.content ?? "{}"));
  }
  return { data: parsed, ms: Date.now() - t0, model, usage: res.usage };
}

/** Nano turns a free-text concept (any language) into short English parts Qloo can match: "gofres y helados" → ["waffles","ice cream"]. */
export async function normalizeConcept(concept) {
  const schema = z.object({ parts: z.array(z.string().min(2).max(40)).min(1).max(3) });
  const system = `Split a business concept into 1-3 short English parts, each a kind of food, drink or shop that could be a place category (e.g. "seafood restaurant", "ice cream", "waffles", "coffee", "ramen", "bakery", "bookstore"). Translate to English. Drop adjectives about quality or style. Return JSON {"parts": [...]}.`;
  const r = await chatJSON({ model: MODELS.nano, system, user: concept, schema, maxTokens: 150 });
  return { parts: r.data.parts.map((p) => p.toLowerCase().trim()), model: r.model, ms: r.ms };
}

const WRITER_SYSTEM = `You are "Abro Aquí", a location-intelligence advisor for small-business owners. You receive structured signals from Qloo (aggregated taste and offer of an area, never about individuals) and a verdict that code already computed. Explain it like a trusted advisor talking to a bar or shop owner: plain words, no jargon, no decimals in the headline, concrete names and metres.
Rules: never change the verdict; never invent a business, rating or number that is not in the signals; never claim to predict success; refer to people only as "the area" or the customer identities listed. If demand.not_measured_for is not empty, say plainly that taste was only measured for demand.measured_for.
Signals: verdict (level, rule_fired, adjustments, offer: rivals within 400 m / 700 m and share of popular places that already serve it); demand (rank = Qloo affinity_rank around the address 0-1, how much the area likes the concept compared with a wide reference; vs_surroundings = rank inside the 1.5 km circle); best_alternative (a nearby busy block the same rules rate better, with distance_m and its nearest rivals; null if none); competitors_within_700m; supply_by_part; already_served_by; gap; area_profile (what the popular places serve, kind, who goes, when).
Respond in {lang}. Return JSON with keys:
headline: one plain sentence with the main reason behind the verdict (the verdict word is shown separately, do not repeat it);
why: 2-5 bullets, each citing a number or a name from the signals;
gap: 0-4 bullets on parts of the idea nobody offers nearby (only from gap);
audience: up to 5 bullets on who goes and when, from area_profile.who/when (cite counts like "Foodies: 31 of 50 popular places");
actions: 2-4 concrete actions (positioning against the named competitors, opening hours from area_profile.when, and the best_alternative if present);
partners: up to 3 objects {name, reason} chosen ONLY from places named in area_profile.places_named that complement (not compete with) the concept;
unknowns: exactly 3 questions about foot traffic, rent and household income.`;

export async function writeReport(signals, lang = "en") {
  return chatJSON({ model: MODELS.writer, system: WRITER_SYSTEM.replace("{lang}", lang === "es" ? "Spanish" : "English"), user: JSON.stringify(signals), schema: ReportSchema, maxTokens: 1400 });
}

/** "Without Qloo": same writer, no signals. Shows what the LLM invents on its own. */
export async function writeReportWithoutQloo({ concept, address }, lang = "en") {
  const system = `You are a location consultant. The owner asks whether to open a business. You have NO data tools; answer from general knowledge only. Respond in ${lang === "es" ? "Spanish" : "English"}. Return JSON with keys headline, why (2-5), gap (0-4), audience (0-5), actions (2-4), partners (0-3 objects {name, reason}), unknowns (exactly 3).`;
  return chatJSON({ model: MODELS.writer, system, user: `Concept: ${concept}\nAddress: ${address}`, schema: ReportSchema, maxTokens: 1200 });
}

/** Template report when the LLM is unavailable: the Qloo demo must survive an LLM outage. Plain words, EN or ES. */
export function templateReport(sig, lang = "en") {
  const es = lang === "es";
  const L = (en, sp) => (es ? sp : en);
  const v = sig.verdict;
  const o = v.offer ?? { c400: 0, c700: 0, share: null };
  const d = sig.demand ?? {};
  const where = sig.address.split(",").slice(0, 2).join(",").trim();
  const c = sig.concept;
  const how = d.rank == null ? "" : d.rank >= 0.9 ? L("a lot", "mucho") : d.rank >= 0.75 ? L("fairly well", "bastante") : L("little", "poco");
  const top = sig.competitors_within_700m[0];
  const topTxt = top ? L(`${top.name} is ${top.distance_m} m away`, `${top.name} está a ${top.distance_m} m`) : "";
  const unmeasured = d.not_measured_for?.length
    ? L(` I could only measure taste for "${d.measured_for.join(", ")}": Qloo has no data on "${d.not_measured_for.join(", ")}" here.`, ` Solo he podido medir el gusto por «${d.measured_for.join(", ")}»: Qloo no tiene datos de «${d.not_measured_for.join(", ")}» aquí.`)
    : "";
  const head = {
    "well-served": L(`The area likes ${c} ${how}, but it is already well served: ${topTxt}${o.c700 > 1 ? ` and there are ${o.c700 - 1} more within 700 m` : ""}.`, `A la zona le gusta ${how} ${c}, pero ya está bien servida: ${topTxt}${o.c700 > 1 ? ` y hay ${o.c700 - 1} más a menos de 700 m` : ""}.`),
    mixed: L(`The area likes ${c} ${how}, with ${o.c700} rivals within 700 m: no clear gap, no saturation.`, `A la zona le gusta ${how} ${c}, con ${o.c700} rivales a menos de 700 m: ni hueco claro ni saturación.`),
    "weak-demand": L(`The taste of the area around ${where} leans away from ${c}.`, `El gusto de la zona de ${where} va por otro lado: ${c} no encaja.`),
    "appetite-without-offer": L(`The area likes ${c} a lot and almost nobody offers it within 700 m.`, `A la zona le gusta mucho ${c} y casi nadie lo ofrece a menos de 700 m.`),
    "no-data": L(`Not enough Qloo data around ${where} to judge ${c}.`, `No hay datos suficientes de Qloo en ${where} para juzgar ${c}.`),
  };
  const comps = sig.competitors_within_700m.slice(0, 3).map((x) => `${x.name} (${x.rating ?? "–"}★, ${x.distance_m} m)`).join(", ");
  const share = sig.already_served_by.filter((x) => x.places > 0).map((x) => L(`${x.places} of the ${x.of} most popular places within 500 m already serve ${x.part}.`, `${x.places} de los ${x.of} locales más populares a 500 m ya sirven ${x.part}.`));
  const b = sig.best_alternative;
  const alt = b ? [L(`Look ${b.distance_m} m away (green ring): the area likes it even more there and has ${b.c700} rivals within 700 m instead of ${o.c700}.`, `Mira a ${b.distance_m} m (círculo verde): allí gusta aún más y hay ${b.c700} rivales a 700 m en lugar de ${o.c700}.`)] : [];
  const when = sig.area_profile.when.slice(0, 2).map((w) => w.name.toLowerCase()).join(L(" and ", " y "));
  return {
    headline: (head[v.rule_code] ?? head.mixed) + unmeasured,
    why: [es ? v.rule_es ?? v.rule_fired : v.rule_fired, ...(es ? v.adjustments_es ?? v.adjustments : v.adjustments), ...share, comps ? L(`Closest direct competitors: ${comps}.`, `Competidores directos más cercanos: ${comps}.`) : L("No direct competitor within 700 m.", "Ningún competidor directo a menos de 700 m.")].slice(0, 5),
    gap: sig.gap.map((g) => L(`Nobody within 700 m offers ${g}.`, `Nadie a menos de 700 m ofrece ${g}.`)),
    audience: [...sig.area_profile.who.slice(0, 4).map((w) => L(`${w.name}: ${w.count} of the ${sig.area_profile.places} most popular places nearby cater to them`, `${w.name}: ${w.count} de los ${sig.area_profile.places} locales más populares`)), ...(when ? [L(`Busiest: ${when}`, `Más actividad: ${when}`)] : [])],
    actions: [...alt, top ? L(`Differentiate from ${top.name} on format and price, not on the same product.`, `Diferénciate de ${top.name} en formato y precio, no con el mismo producto.`) : L("Be the first: own the category name in local search before anyone else does.", "Sé el primero: hazte con el nombre de la categoría en las búsquedas locales."), when ? L(`Open when the area is busiest for places like yours: ${when}.`, `Abre cuando la zona tiene más actividad: ${when}.`) : L("Test opening hours for two weeks before fixing them.", "Prueba horarios dos semanas antes de fijarlos.")].slice(0, 4),
    partners: [],
    unknowns: es ? ["Tráfico de gente delante de la puerta (cuéntalo: un día laborable a las 13:00 y un sábado a las 18:00)", "Alquiler y licencia frente al ticket medio que esperas", "Renta de los hogares de la zona (Qloo mide gusto, no capacidad de gasto)"] : v.unknowns,
  };
}

/** Chat with tools (Lightning). tools: {name: {description, parameters, run}} */
export async function chatWithTools({ messages, tools, maxRounds = 8, maxTokens = 900 }) {
  const toolDefs = Object.entries(tools).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
  const calls = [];
  for (let i = 0; i < maxRounds; i++) {
    spend();
    const t0 = Date.now();
    const res = await client.chat.completions.create({ model: MODELS.fast, messages, tools: toolDefs, tool_choice: "auto", temperature: 0.3, max_tokens: maxTokens });
    const think_ms = Date.now() - t0;
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { text: msg.content ?? "", calls, model: MODELS.fast };
    for (const call of msg.tool_calls) {
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
  return { text: "Stopped after too many tool rounds.", calls, model: MODELS.fast };
}
