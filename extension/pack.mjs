#!/usr/bin/env node
// The only supported way to build the Chrome Web Store zip:
//   1. refuses unless the extension is in its release state (check-release.mjs),
//   2. refuses unless extension/ has no uncommitted changes,
//   3. zips the COMMITTED extension/ tree (git archive), without dev tooling.
//
//   node extension/pack.mjs      → extension/dist/reidey-extension-<version>.zip

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: here, encoding: "utf8" }).trim();

execFileSync(process.execPath, [join(here, "check-release.mjs")], { stdio: "inherit" });

const dirty = git("status", "--porcelain", "--", ".");
if (dirty) {
  console.error("extension/ has uncommitted changes — commit or revert them first:\n" + dirty);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const root = git("rev-parse", "--show-toplevel");
mkdirSync(join(here, "dist"), { recursive: true }); // git-ignored (extension/.gitignore)
const out = join(here, "dist", `reidey-extension-${version}.zip`);

// Dev-only files never ship in the store package.
const exclude = ["tests", "dev-hosts.mjs", "check-release.mjs", "pack.mjs", "README.md", ".gitignore"].map((p) => `:(exclude)${p}`);
// Run from the repo root: archive pathspecs are relative to the cwd, and the
// archived tree (HEAD:extension) has extension/ as its root.
execFileSync("git", ["archive", "--format=zip", "-o", out, "HEAD:extension", "--", ".", ...exclude], { cwd: root, stdio: "inherit" });
console.log(`packed ${out}`);
