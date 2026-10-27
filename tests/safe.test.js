import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubPII } from "../src/safe.js";

test("e-mails and phone numbers are removed before any model or search call", () => {
  const q = "Write to ana.lopez+bcn@gmail.com or call +34 612 345 678 / (93) 412-34-56 about Paral·lel 40";
  const out = scrubPII(q);
  assert.doesNotMatch(out, /@|612|412/);
  assert.match(out, /\[email\]/);
  assert.match(out, /\[phone\]/);
  assert.match(out, /Paral·lel 40/, "street numbers survive");
});
