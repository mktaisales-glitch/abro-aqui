// NVIDIA Nemotron on Nebius Token Factory through the OpenAI SDK — see specs/03-agent.md.
import OpenAI from "openai";
import { z } from "zod";

export const MODELS = {
  fast: process.env.MODEL_FAST || "nvidia/Nemotron-3_5-Lightning",
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

async function chatJSON({ model, system, user, schema, name, maxTokens = 1200 }) {
  const t0 = Date.now();
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

/** Lightning picks the Qloo tags for a concept from the candidates. */
export async function pickTags(concept, candidates) {
  const schema = z.object({ category_tag: z.string(), heatmap_tag: z.string(), label: z.string() });
  const system = `You map a business concept to Qloo tag ids. Pick exactly one category_tag that starts with "urn:tag:category:place:" (used to find competitor places) and one heatmap_tag that starts with "urn:tag:genre:place:" (used for the taste heatmap). If no genre tag fits, reuse the category tag. Return JSON {category_tag, heatmap_tag, label}. Only use ids from the list.`;
  const user = `Concept: ${concept}\nCandidates:\n${candidates.map((c) => `${c.id} — ${c.name}`).join("\n")}`;
  const r = await chatJSON({ model: MODELS.fast, system, user, schema, name: "tags", maxTokens: 200 });
  if (!candidates.some((c) => c.id === r.data.category_tag)) throw new Error("LLM picked a tag outside the candidates");
  return { ...r.data, model: r.model, ms: r.ms };
}

const WRITER_SYSTEM = `You are "Abro Aquí", a location-intelligence consultant for small-business owners. You receive structured signals from Qloo (aggregated cultural taste of an area, never about individuals) and a verdict computed by code. Write the report in plain, concrete language, like a trusted advisor talking to the owner. Never invent businesses, ratings or numbers that are not in the signals. Never claim to predict success. Mention the three things the data cannot see. Respond in ${"{lang}"}. Return JSON with keys: headline (one sentence with the verdict), why (2-5 bullets citing the signals), gap (0-4 bullets: what the area likes that nobody offers), audience (up to 5 bullets: who passes by, from the taste tags and brands), actions (2-4 concrete actions: positioning, hours, launch), partners (up to 3 nearby businesses from the competitor/affine lists that are complementary, with reason), unknowns (exactly 3 questions the owner must answer: foot traffic, rent, income).`;

export async function writeReport(signals, lang = "en") {
  const user = JSON.stringify(signals);
  return chatJSON({ model: MODELS.writer, system: WRITER_SYSTEM.replace("{lang}", lang === "es" ? "Spanish" : "English"), user, schema: ReportSchema, name: "report", maxTokens: 1400 });
}

/** "Without Qloo": same writer, no signals. Shows what the LLM invents on its own. */
export async function writeReportWithoutQloo({ concept, address }, lang = "en") {
  const system = `You are a location consultant. The owner asks whether to open a business. You have NO data tools; answer from general knowledge only. Respond in ${lang === "es" ? "Spanish" : "English"}. Return JSON with keys headline, why (2-5), gap (0-4), audience (0-5), actions (2-4), partners (0-3 objects {name, reason}), unknowns (exactly 3).`;
  return chatJSON({ model: MODELS.writer, system, user: `Concept: ${concept}\nAddress: ${address}`, schema: ReportSchema, name: "report-noqloo", maxTokens: 1200 });
}

/** Template report when the LLM is unavailable: the Qloo demo must survive an LLM outage. */
export function templateReport(signals) {
  const v = signals.verdict;
  const comps = signals.competitors.slice(0, 3).map((c) => `${c.name} (${c.rating ?? "n/a"}★, ${c.distance_m} m)`).join(", ");
  return {
    headline: `${signals.concept} at ${signals.address}: ${v.level}. ${v.rule_fired}.`,
    why: [v.rule_fired, ...v.adjustments, comps ? `Direct competitors within 700 m: ${comps}` : "No direct competitor within 700 m"],
    gap: signals.gap.slice(0, 4).map((g) => `${g.name} (affinity ${g.affinity?.toFixed(2)})`),
    audience: signals.zone_taste.slice(0, 5).map((t) => t.name),
    actions: ["Position against the strongest nearby competitor", "Match opening hours to the area's peak taste (bars/tapas → evenings)"],
    partners: [],
    unknowns: v.unknowns,
  };
}

/** Chat with tools (Lightning). tools: {name: {description, parameters, run}} */
export async function chatWithTools({ messages, tools, maxRounds = 8 }) {
  const toolDefs = Object.entries(tools).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
  const calls = [];
  for (let i = 0; i < maxRounds; i++) {
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
