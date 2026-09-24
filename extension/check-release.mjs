#!/usr/bin/env node
// Fails when the extension is not in its release state: no localhost /
// 127.0.0.1 in the manifest's hosts or pair matches, nor in the pairing and
// backend allowlists of pair.js / background.js. A build made with
// `dev-hosts.mjs on` would let any page on the manager's localhost re-pair the
// extension and receive the next captured Uber session.
//
// Only the allowlist lines are checked — the harmless `isLocal` protocol checks
// mention localhost on purpose. Run by CI and by pack.mjs.
//
//   node extension/check-release.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEV_HOST = /(localhost|127\.0\.0\.1)/i;
const problems = [];

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
for (const host of manifest.host_permissions ?? []) {
  if (DEV_HOST.test(host)) problems.push(`manifest.json host_permissions: ${host}`);
}
for (const script of manifest.content_scripts ?? []) {
  for (const match of script.matches ?? []) {
    if (DEV_HOST.test(match)) problems.push(`manifest.json content_scripts.matches: ${match}`);
  }
}

const ALLOWLIST_LINE = /const (ALLOWED_API_HOSTS|ALLOWED_PAIR_ORIGINS) = \[[^\]]*\];/g;
for (const file of ["background.js", "pair.js"]) {
  const source = readFileSync(join(here, file), "utf8");
  for (const [line] of source.matchAll(ALLOWLIST_LINE)) {
    if (DEV_HOST.test(line)) problems.push(`${file}: ${line}`);
  }
}

if (problems.length > 0) {
  console.error("extension is NOT in release state (run `node extension/dev-hosts.mjs off`):");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`extension ${manifest.version}: release state OK`);
