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

test("coordinates, amounts and ranges survive; Spanish IDs and IBANs do not", () => {
  assert.equal(scrubPII("41.379030, 2.154780"), "41.379030, 2.154780");
  assert.match(scrubPII("rent 2500-3000 a month, 1.500.000 budget"), /2500-3000.*1\.500\.000/);
  assert.equal(scrubPII("my DNI 12345678Z"), "my DNI [id]");
  assert.equal(scrubPII("IBAN ES91 2100 0418 4502 0005 1332"), "IBAN [iban]");
  assert.match(scrubPII("call 612 345 678"), /\[phone\]/);
});

test("an address with an e-mail and a phone reaches no prompt: the API scrubs it and keeps the street", () => {
  const a = scrubPII("Carrer de Sants 100, 08014 Barcelona, llamar a juan@example.com 600123456");
  assert.ok(!/juan@example\.com/.test(a) && !/600123456/.test(a), a);
  assert.match(a, /Carrer de Sants 100, 08014 Barcelona/);
});
