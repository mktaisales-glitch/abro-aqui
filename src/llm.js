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
const client = llmEnabled ? new OpenAI({ baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/", apiKey: key }) : null;

export const ReportSchema = z.object({
  headline: z.string().max(200),
  why: z.array(z.string()).min(2).max(5),
  gap: z.array(z.string()).max(4),
  audience: z.array(z.string()).max(5),
  actions: z.array(z.string()).min(2).max(4),
  partners: z.array(z.object({ name: z.string(), reason: z.string() })).max(3),
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
    // one repair round
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

const WRITER_SYSTEM = `You are "Abro Aquí", a location-intelligence advisor for small-business owners. You receive structured signals from Qloo (aggregated taste and offer of an area, never about individuals) and a verdict that code already computed. Explain it like a trusted advisor talking to the owner: plain words, concrete numbers from the signals, no hype.
Rules: never change the verdict; never invent a business, rating or number that is not in the signals; never claim to predict success; refer to people only as "the area" or the customer identities listed.
Signals: verdict (level, rule_fired, adjustments), nearest_cell (affinity = how much the area likes the concept 0-1, popularity = how much of it is already offered 0-1), best_alternative_cell (with distance_m), competitors_within_700m, supply_by_part (competitors per part of the concept), already_served_by (how many of the area's most popular places already serve it), gap (parts nobody offers nearby), area_profile (what the popular places serve, kind, who goes, when).
Respond in {lang}. Return JSON with keys:
headline: one sentence with the main reason behind the verdict and its key number (the verdict word itself is shown separately, do not repeat it);
why: 2-5 bullets, each citing a number from the signals;
gap: 0-4 bullets on what the area likes that nobody offers;
audience: up to 5 bullets on who goes and when, from area_profile.who/when (cite counts like "Foodies: 31 of 50 popular places");
actions: 2-4 concrete actions (positioning against the named competitors, opening hours from area_profile.when, where to move if best_alternative_cell is better);
partners: up to 3 objects {name, reason} chosen ONLY from places named in the signals that complement (not compete with) the concept;
unknowns: exactly 3 questions about foot traffic, rent and household income.`;

export async function writeReport(signals, lang = "en") {
  return chatJSON({ model: MODELS.writer, system: WRITER_SYSTEM.replace("{lang}", lang === "es" ? "Spanish" : "English"), user: JSON.stringify(signals), schema: ReportSchema, maxTokens: 1400 });
}

/** "Without Qloo": same writer, no signals. Shows what the LLM invents on its own. */
export async function writeReportWithoutQloo({ concept, address }, lang = "en") {
  const system = `You are a location consultant. The owner asks whether to open a business. You have NO data tools; answer from general knowledge only. Respond in ${lang === "es" ? "Spanish" : "English"}. Return JSON with keys headline, why (2-5), gap (0-4), audience (0-5), actions (2-4), partners (0-3 objects {name, reason}), unknowns (exactly 3).`;
  return chatJSON({ model: MODELS.writer, system, user: `Concept: ${concept}\nAddress: ${address}`, schema: ReportSchema, maxTokens: 1200 });
}

/** Template report when the LLM is unavailable: the Qloo demo must survive an LLM outage. */
export function templateReport(sig) {
  const v = sig.verdict;
  const n = sig.nearest_cell;
  const where = sig.address.split(",").slice(0, 2).join(",").trim();
  const share0 = sig.already_served_by[0];
  const shareTxt = share0 && share0.places ? `, and ${share0.places} of the ${share0.of} most popular places nearby already serve ${share0.part}` : "";
  const headByLevel = {
    RED: `The area around ${where} does not ask for ${sig.concept} (affinity ${n?.affinity?.toFixed(2)})${shareTxt}.`,
    AMBER: `The area likes ${sig.concept} only moderately (affinity ${n?.affinity?.toFixed(2)}) and ${sig.competitors_within_700m.length} direct competitors are within 700 m.`,
    "AMBER-GREEN": `The area likes ${sig.concept} (affinity ${n?.affinity?.toFixed(2)}) and little of it is on offer yet. Check the three things below before you sign.`,
    UNKNOWN: `Not enough Qloo data around ${where} to judge ${sig.concept}.`,
  };
  const comps = sig.competitors_within_700m.slice(0, 3).map((c) => `${c.name} (${c.rating ?? "n/a"}★, ${c.distance_m} m)`).join(", ");
  const share = sig.already_served_by.filter((s) => s.places > 0).map((s) => `${s.places} of the ${s.of} most popular places within 500 m already serve ${s.part}.`);
  const alt = sig.best_alternative_cell && n && sig.best_alternative_cell.affinity > n.affinity + 0.1 ? [`Look ${sig.best_alternative_cell.distance_m} m away: affinity ${sig.best_alternative_cell.affinity.toFixed(2)} there vs ${n.affinity.toFixed(2)} here, with supply ${sig.best_alternative_cell.popularity.toFixed(2)}.`] : [];
  const when = sig.area_profile.when.slice(0, 2).map((w) => w.name.toLowerCase()).join(" and ");
  return {
    headline: headByLevel[v.level],
    why: [v.rule_fired, ...v.adjustments, ...share, comps ? `Closest direct competitors: ${comps}.` : "No direct competitor within 700 m."].slice(0, 5),
    gap: sig.gap.map((g) => `Nobody within 700 m offers ${g}.`),
    audience: [...sig.area_profile.who.slice(0, 4).map((w) => `${w.name}: ${w.count} of the ${sig.area_profile.places} most popular places nearby cater to them`), ...(when ? [`Busiest: ${when}`] : [])],
    actions: [...alt, comps ? `Differentiate from ${sig.competitors_within_700m[0].name} on format and price, not on the same product.` : "Be the first: own the category name in local search before anyone else does.", when ? `Open when the area is busiest for places like yours: ${when}.` : "Test opening hours for two weeks before fixing them."].slice(0, 4),
    partners: [],
    unknowns: v.unknowns,
  };
}

/** Chat with tools (Lightning). tools: {name: {description, parameters, run}} */
export async function chatWithTools({ messages, tools, maxRounds = 8 }) {
  const toolDefs = Object.entries(tools).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
  const calls = [];
  for (let i = 0; i < maxRounds; i++) {
    spend();
    const res = await client.chat.completions.create({ model: MODELS.fast, messages, tools: toolDefs, tool_choice: "auto", temperature: 0.3, max_tokens: 900 });
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { text: msg.content ?? "", calls, model: MODELS.fast };
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
      let result;
      try { result = await tools[call.function.name].run(args); } catch (e) { result = { error: String(e.message) }; }
      calls.push({ name: call.function.name, args, result });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { text: "Stopped after too many tool rounds.", calls, model: MODELS.fast };
}
