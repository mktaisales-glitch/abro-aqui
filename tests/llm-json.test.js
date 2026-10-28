// Model replies are not always bare JSON: reasoning blocks, code fences, the answer in reasoning_content, prose around it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
delete process.env.NEBIUS_API_KEY;
const S = z.object({ parts: z.array(z.string()).min(1) });

test("extractJSON: think blocks, fences, reasoning_content", async () => {
  const { extractJSON } = await import("../src/llm.js");
  assert.deepEqual(extractJSON({ content: '<think>let me see {not this}</think>\n```json\n{"parts":["seafood"]}\n```' }), { parts: ["seafood"] });
  assert.deepEqual(extractJSON({ content: null, reasoning_content: 'Answer: {"a":1}' }), { a: 1 });
  assert.throws(() => extractJSON({ content: "" }), /no JSON in the reply \(empty\)/);
});

test("extractJSON: realistic messy replies", async () => {
  const { extractJSON } = await import("../src/llm.js");
  // valid answer, reasoning full of braces
  assert.deepEqual(extractJSON({ content: '{"parts":["ramen"]}', reasoning_content: "maybe {x} or {y: 1}" }, S), { parts: ["ramen"] });
  // only a closing </think> (the template opened it in the prompt)
  assert.deepEqual(extractJSON({ content: 'I think {foo} is wrong.</think>{"parts":["coffee"]}' }, S), { parts: ["coffee"] });
  // prose after the object with a stray brace
  assert.deepEqual(extractJSON({ content: 'Here: {"parts":["tea"]} hope it helps :}' }, S), { parts: ["tea"] });
  // two objects: the first that passes the schema wins
  assert.deepEqual(extractJSON({ content: '{"note":"draft"} {"parts":["bagels"]}' }, S), { parts: ["bagels"] });
  // braces inside strings
  assert.deepEqual(extractJSON({ content: '{"parts":["a {b} c"]}' }, S), { parts: ["a {b} c"] });
  // objects found but none valid: schema error, not a JSON error
  assert.throws(() => extractJSON({ content: '{"x":1}' }, S), /parts/);
});

test("afterThink strips reasoning from tool-calling answers", async () => {
  const { afterThink } = await import("../src/llm.js");
  assert.equal(afterThink("<think>hmm</think>Stay put."), "Stay put.");
  assert.equal(afterThink("reasoning...</think>  Move 500 m east."), "Move 500 m east.");
  assert.equal(afterThink("Plain answer."), "Plain answer.");
});
