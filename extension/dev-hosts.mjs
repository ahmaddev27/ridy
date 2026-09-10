#!/usr/bin/env node
// Toggle the LOCAL DEV hosts (localhost / 127.0.0.1) in the extension.
//
// The released extension must not carry them: the store build used to allowlist
// http://localhost:3000 in the manifest AND in both pairing allowlists, so any page
// served on port 3000 of the manager's own machine could re-pair the extension to a
// local endpoint and receive the next captured Uber session.
//
// The extension ships unbundled (raw MV3 files, no build step), so this script IS
// the build step. It edits the files in place, textually, and is reversible:
//
//   node dev-hosts.mjs on    # develop against localhost
//   node dev-hosts.mjs off   # restore the release state (ALWAYS before zipping)
//
// `off` is the committed state — `git status` must be clean before a store upload.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mode = (process.argv[2] || "").toLowerCase();
if (mode !== "on" && mode !== "off") {
  console.error("usage: node dev-hosts.mjs <on|off>");
  process.exit(1);
}
const dev = mode === "on";

const DEV_PERMISSION_LINES = [
  '    "http://localhost:8090/*",',
  '    "http://127.0.0.1:8090/*",',
  '    "http://localhost:3000/*",',
  '    "http://127.0.0.1:3000/*",',
];

const PROD_PAIR_MATCHES = '      "matches": ["https://reidey.de/*"],';
const DEV_PAIR_MATCHES =
  '      "matches": ["http://localhost:3000/*", "http://127.0.0.1:3000/*", "https://reidey.de/*"],';

const PROD_HOSTS = 'const ALLOWED_API_HOSTS = ["reidey.de"];';
const DEV_HOSTS = 'const ALLOWED_API_HOSTS = ["reidey.de", "localhost", "127.0.0.1"];';
const PROD_ORIGINS = 'const ALLOWED_PAIR_ORIGINS = ["https://reidey.de"];';
const DEV_ORIGINS =
  'const ALLOWED_PAIR_ORIGINS = ["https://reidey.de", "http://localhost:3000", "http://127.0.0.1:3000"];';

// Edited line by line (not JSON.parse/stringify) so the hand-formatted manifest
// keeps its shape and a diff shows only the hosts that actually changed. The file
// may be checked out with CRLF, so keep whatever line ending it already uses.
const manifestPath = join(here, "manifest.json");
const raw = readFileSync(manifestPath, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";

const lines = raw.split(/\r?\n/).filter((line) => !DEV_PERMISSION_LINES.includes(line));
if (dev) {
  const anchor = lines.findIndex((line) => line.includes('"*://*.uber.com/*"'));
  if (anchor === -1) {
    console.error("manifest.json: host_permissions anchor not found");
    process.exit(1);
  }
  lines.splice(anchor + 1, 0, ...DEV_PERMISSION_LINES);
}

const manifest = lines
  .map((line) => (line === (dev ? PROD_PAIR_MATCHES : DEV_PAIR_MATCHES) ? (dev ? DEV_PAIR_MATCHES : PROD_PAIR_MATCHES) : line))
  .join(eol);
writeFileSync(manifestPath, manifest);

for (const file of ["background.js", "pair.js"]) {
  const path = join(here, file);
  const source = readFileSync(path, "utf8")
    .replace(/const ALLOWED_API_HOSTS = \[[^\]]*\];/, dev ? DEV_HOSTS : PROD_HOSTS)
    .replace(/const ALLOWED_PAIR_ORIGINS = \[[^\]]*\];/, dev ? DEV_ORIGINS : PROD_ORIGINS);
  writeFileSync(path, source);
}

console.log(dev ? "dev hosts ENABLED — do not ship this build" : "dev hosts removed — release state");
