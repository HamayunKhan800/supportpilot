// Starts the standalone production server for E2E tests, copying static assets into
// place first (the same layout as the Docker image).
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const root = ".next/standalone";
if (!existsSync(`${root}/server.js`)) {
  console.error("No standalone build found. Run `pnpm build` first.");
  process.exit(1);
}
cpSync(".next/static", `${root}/.next/static`, { recursive: true });
cpSync("public", `${root}/public`, { recursive: true });
const child = spawn(process.execPath, ["server.js"], { cwd: root, stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
