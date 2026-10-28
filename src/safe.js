// Responsible use (specs/05-safe-use.md): e-mails, phone numbers, Spanish ID numbers and IBANs never reach a model or a search engine.
const COORDS = /-?\d{1,3}\.\d{3,}\s*,?\s*-?\d{1,3}\.\d{3,}/g; // "41.379030, 2.154780" is a place, not a phone
const RANGE = /\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{3,5}\s*[-–]\s*\d{3,5}\b/g; // 1.500.000 · 2500-3000 (amounts and ranges)
export function scrubPII(t) {
  const keep = [];
  const hold = (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; };
  let s = String(t).replace(COORDS, hold).replace(RANGE, hold);
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, "[iban]")
    .replace(/\b[XYZ]?\d{7,8}[A-Z]\b/g, "[id]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => keep[+i]);
}
