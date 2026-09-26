// Copies the Firebase compat bundles the push service worker needs into
// public/firebase/, so the worker imports them same-origin. The site CSP
// (docker/Caddyfile) allows scripts from 'self' only, which blocked the old
// importScripts() from www.gstatic.com and broke background web push. Copying
// from node_modules also keeps the worker on the same SDK version as the app.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "firebase");
mkdirSync(outDir, { recursive: true });

for (const file of ["firebase-app-compat.js", "firebase-messaging-compat.js"]) {
  copyFileSync(join(root, "node_modules", "firebase", file), join(outDir, file));
}
