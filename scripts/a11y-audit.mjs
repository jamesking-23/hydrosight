// Accessibility audit (Phase 10): runs axe-core against WCAG 2.0/2.1/2.2 A and AA rules in headless
// Chromium at a desktop and a phone width. Pages that need a sign-in are NOT covered (they redirect).
// Usage: start the web app (pnpm --filter web build && pnpm --filter web start -p 3100), then
//   npm i --no-save axe-core playwright && node scripts/a11y-audit.mjs http://localhost:3100
// Automated checks find roughly a third of real problems; they do not replace a manual screen-reader pass.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:3100";
const pages = ["/", "/about", "/capabilities", "/solutions", "/industries", "/technology", "/plans", "/contact", "/demo", "/login", "/signup", "/community"];
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const browser = await chromium.launch();
let total = 0;
for (const width of [1280, 375]) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.evaluate(axeSrc);
    const r = await page.evaluate((t) => axe.run(document, { runOnly: { type: "tag", values: t } }), tags);
    total += r.violations.length;
    console.log(`${width}px ${p}: ${r.violations.length} violations`);
    for (const v of r.violations) console.log(`  ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`);
  }
}
await browser.close();
process.exit(total === 0 ? 0 : 1);
