// Render the PDF report from a saved analysis (the JSON returned by POST /api/analyze), e.g. for a demo:
//   node scripts/report-from-json.js analysis.json [out.pdf] [en|es] [scout.json] [launch.json]
import fs from "node:fs";
import { buildReportPdf, reportFileName } from "../src/report-pdf.js";

const [input, out, lang = "en", scoutFile, launchFile] = process.argv.slice(2);
if (!input) { console.error("usage: node scripts/report-from-json.js analysis.json [out.pdf] [en|es] [scout.json] [launch.json]"); process.exit(1); }
const read = (f) => (f ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const ctx = read(input);
const pdf = await buildReportPdf({ ctx, scout: read(scoutFile), launch: read(launchFile), lang });
const file = out ?? reportFileName(ctx);
fs.writeFileSync(file, pdf);
console.log(`${file} (${Math.round(pdf.length / 1024)} KB)`);
