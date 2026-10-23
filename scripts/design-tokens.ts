/**
 * Writes src/app/theme.css from src/lib/design/tokens.ts.
 *
 *   pnpm design:tokens          regenerate the stylesheet
 *   pnpm design:tokens --check  exit 1 if the stylesheet is out of date (no write)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { themeCss } from "../src/lib/design/tokens";

const target = resolve(import.meta.dirname, "../src/app/theme.css");
const css = themeCss();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // A missing file counts as out of date.
  }
  if (current !== css) {
    console.error("src/app/theme.css is out of date. Run: pnpm design:tokens");
    process.exit(1);
  }
  console.log("src/app/theme.css is up to date.");
} else {
  writeFileSync(target, css);
  console.log(`Wrote ${target}`);
}
