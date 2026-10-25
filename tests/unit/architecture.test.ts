import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Architecture fitness test (docs/plans/architecture-audit.md, P1.1). It turns the dependency
 * rules in docs/02-architecture.md into a check that runs with the unit tests:
 *  1. no runtime import cycles
 *  2. server and worker code never imports UI code (src/app, src/components)
 *  3. UI code never imports the database layer or a repository (health probe excepted)
 *  4. a module reads another module's repository only through an edge listed in
 *     CROSS_MODULE_REPOSITORY_EDGES, each with a reason. New edges fail here, and edges that no
 *     longer exist must be removed from the list, so it only ever shrinks or is re-justified.
 * Type-only imports are erased at build time, so they are ignored for cycles but still count for
 * the layer rules (a UI file has no business naming database types either).
 */

const SRC = path.resolve(__dirname, "../../src");

/** "importer -> imported" (paths relative to src/server/modules), and why the shortcut is right. */
const CROSS_MODULE_REPOSITORY_EDGES: Record<string, string> = {
  "drafts/actions.ts -> tickets/repository.ts":
    "Approve & send locks the ticket and inserts the reply in the draft's transaction.",
  "drafts/service.ts -> ai/repository.ts": "Reads the AI policy before spending on retrieval.",
  "drafts/service.ts -> tickets/repository.ts": "Reads the ticket and its thread for the prompt.",
  "drafts/service.ts -> triage/repository.ts": "Reads the triaged language for the prompt.",
  "kb/repository.ts -> ai/repository.ts":
    "Records embedding usage in the same transaction that saves the chunks.",
  "triage/job.ts -> tickets/repository.ts": "Reads the ticket and its thread for the prompt.",
  "analytics/service.ts -> eval/repository.ts": "Lists stored evaluation runs for the dashboard.",
  "tickets/service.ts -> workspaces/repository.ts": "Lists members for the assignee picker.",
  "tickets/service.ts -> triage/repository.ts":
    "An agent's label change records the triage decision in the ticket's transaction.",
};

interface Edge {
  to: string;
  typeOnly: boolean;
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null; // a package, not our code
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function isTypeOnlyImport(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly;
  const clause = node.importClause;
  if (!clause) return false; // side-effect import
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  // `import { type A, type B } from "x"` is erased too; a default import or `* as` is not.
  return (
    !clause.name &&
    named !== undefined &&
    ts.isNamedImports(named) &&
    named.elements.length > 0 &&
    named.elements.every((e) => e.isTypeOnly)
  );
}

function importsOf(file: string): Edge[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const edges: Edge[] = [];
  const add = (specifier: string, typeOnly: boolean) => {
    const to = resolveImport(file, specifier);
    if (to) edges.push({ to, typeOnly });
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text, isTypeOnlyImport(node));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const graph = new Map(
  listSourceFiles(SRC).map((file) => [rel(file), importsOf(file).map((e) => ({ ...e, to: rel(e.to) }))]),
);
const allEdges = [...graph].flatMap(([from, edges]) => edges.map((e) => ({ from, ...e })));

/** Strongly connected components with more than one file (Tarjan), over runtime imports only. */
function runtimeCycles(): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const cycles: string[][] = [];
  const connect = (v: string) => {
    indexOf.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const { to, typeOnly } of graph.get(v) ?? []) {
      if (typeOnly) continue;
      if (!indexOf.has(to)) {
        connect(to);
        low.set(v, Math.min(low.get(v)!, low.get(to)!));
      } else if (onStack.has(to)) {
        low.set(v, Math.min(low.get(v)!, indexOf.get(to)!));
      }
    }
    if (low.get(v) === indexOf.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const v of graph.keys()) if (!indexOf.has(v)) connect(v);
  return cycles;
}

const isUi = (f: string) => f.startsWith("app/") || f.startsWith("components/") || f.startsWith("lib/");
const isDataLayer = (f: string) => f.startsWith("server/platform/db/") || /(^|\/)repository\.ts$/.test(f);
const moduleOf = (f: string) => /^server\/modules\/([^/]+)\//.exec(f)?.[1];

describe("architecture rules", () => {
  it("sees the whole source tree", () => {
    // Guards against the rules passing because the scan found nothing (281 files, 905 imports today).
    expect(graph.size).toBeGreaterThan(250);
    expect(allEdges.length).toBeGreaterThan(800);
  });

  it("has no runtime import cycles", () => {
    expect(runtimeCycles()).toEqual([]);
  });

  it("keeps server and worker code independent of UI code", () => {
    const violations = allEdges.filter(
      (e) =>
        (e.from.startsWith("server/") || e.from.startsWith("worker/")) &&
        (e.to.startsWith("app/") || e.to.startsWith("components/")),
    );
    expect(violations.map((e) => `${e.from} -> ${e.to}`)).toEqual([]);
  });

  it("keeps the database layer out of UI code (health probe excepted)", () => {
    const violations = allEdges.filter(
      (e) => isUi(e.from) && isDataLayer(e.to) && e.from !== "app/api/ready/route.ts",
    );
    expect(violations.map((e) => `${e.from} -> ${e.to}`)).toEqual([]);
  });

  it("only reads other modules' repositories through listed edges", () => {
    const actual = new Set(
      allEdges
        .filter((e) => {
          const from = moduleOf(e.from);
          const to = moduleOf(e.to);
          return from && to && from !== to && /\/repository\.ts$/.test(e.to);
        })
        .map((e) => `${e.from.replace("server/modules/", "")} -> ${e.to.replace("server/modules/", "")}`),
    );
    const listed = new Set(Object.keys(CROSS_MODULE_REPOSITORY_EDGES));
    expect({
      unlisted: [...actual].filter((e) => !listed.has(e)).sort(),
      stale: [...listed].filter((e) => !actual.has(e)).sort(),
    }).toEqual({ unlisted: [], stale: [] });
  });
});
