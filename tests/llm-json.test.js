// Model replies are not always bare JSON: reasoning blocks, code fences, or the answer in reasoning_content.
import { test } from "node:test";
import assert from "node:assert/strict";
delete process.env.NEBIUS_API_KEY;

test("extractJSON finds the object behind <think> blocks, fences and reasoning_content", async () => {
  const { extractJSON } = await import("../src/llm.js");
  assert.deepEqual(extractJSON({ content: '<think>let me see {not this}</think>\n```json\n{"parts":["seafood"]}\n```' }), { parts: ["seafood"] });
  assert.deepEqual(extractJSON({ content: null, reasoning_content: 'Answer: {"a":1}' }), { a: 1 });
  assert.throws(() => extractJSON({ content: "" }), /no JSON in the reply \(empty\)/);
});
