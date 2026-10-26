// Minimal OpenAI-compatible mock of Nebius Token Factory, for wiring tests only.
import http from "node:http";
export function startMock(port = 3199) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body || "{}");
      calls.push({ model: b.model, tools: !!b.tools, json: b.response_format?.type });
      let message;
      const sys = b.messages?.[0]?.content || "";
      if (b.tools) {
        const last = b.messages.at(-1);
        message = last.role === "tool" ? { role: "assistant", content: "Ignoring it, 6 competitors remain; the verdict does not change." } : { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "nearby_competitors", arguments: JSON.stringify({ radius_m: 700, exclude_names: ["Puertecillo"] }) } }] };
      } else if (sys.startsWith("Split a business concept")) {
        message = { role: "assistant", content: JSON.stringify({ parts: ["seafood restaurant"] }) };
      } else {
        message = { role: "assistant", content: JSON.stringify({ headline: "The area does not ask for seafood (affinity 0.29).", why: ["affinity 0.29", "13 of 50 serve seafood"], gap: [], audience: ["Locals: 23 of 50"], actions: ["Look 635 m away", "Open evenings"], partners: [{ name: "Sala Apolo", reason: "evening crowd" }], unknowns: ["Foot traffic?", "Rent?", "Income?"] }) };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    });
  });
  return new Promise((r) => server.listen(port, () => r({ server, calls })));
}
