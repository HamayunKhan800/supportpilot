import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Docker build copies the repo minus .dockerignore and then type-checks everything
 * `next build` sees. Code outside an ignored folder that imports from one passes every
 * other CI job and fails only the Docker build (found when scripts/lib/kb-corpus.ts
 * imported tests/support/pdf). This catches it on every unit-test run.
 */
const ROOT = path.resolve(__dirname, "../..");
const ignoredDirs = readFileSync(path.join(ROOT, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim().replace(/\/$/, ""))
  .filter((l) => /^[\w.-]+$/.test(l) && !l.startsWith("!"));
/** Ignored because the build creates them (e.g. next-env.d.ts points into .next), not source. */
const GENERATED = new Set([".next", ".build", "coverage", "node_modules"]);
const sourceDirs = ignoredDirs.filter((d) => !GENERATED.has(d));
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const SKIP = new Set(["node_modules", ".git", ...ignoredDirs]);

function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? codeFiles(full) : CODE.test(e.name) ? [full] : [];
  });
}

/** Relative module specifiers in import/export/require/dynamic import statements. */
function relativeImports(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm;
  return [...source.matchAll(re)].map((m) => m[1]!);
}

describe("Docker build context (.dockerignore)", () => {
  it("excludes the folders this test protects", () => {
    expect(sourceDirs).toEqual(expect.arrayContaining(["tests", "docs"]));
  });

  it("no code the image builds imports from a folder Docker leaves out", () => {
    const files = codeFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      relativeImports(readFileSync(file, "utf8"))
        .map((spec) => path.relative(ROOT, path.resolve(path.dirname(file), spec)))
        .filter((target) => sourceDirs.includes(target.split(path.sep)[0]!))
        .map((target) => `${path.relative(ROOT, file)} -> ${target}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds such an import when there is one (the check itself works)", () => {
    expect(relativeImports('import { buildPdf } from "../../tests/support/pdf";')).toEqual([
      "../../tests/support/pdf",
    ]);
    expect(relativeImports('const m = await import("../docs/x");\nexport * from "./a";')).toEqual([
      "../docs/x",
      "./a",
    ]);
  });
});
