// Responsible use (specs/05-safe-use.md): e-mails and phone numbers never reach a model or a search engine.
export const scrubPII = (t) => t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
