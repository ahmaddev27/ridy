// Supervisor loop: keep one RamenStream running per active fleet session.
// Polls the backend for the session list and starts/stops streams to match.

import { config } from "./config.js";
import { api } from "./api.js";
import { RamenStream } from "./stream.js";

const streams = new Map(); // sessionId -> RamenStream

async function reconcile() {
  let sessions;
  try {
    sessions = await api.sessions();
  } catch (e) {
    console.error(`session poll failed: ${e.message}`);
    return;
  }

  const activeIds = new Set(sessions.map((s) => s.id));

  // Stop streams whose session is gone or no longer active.
  for (const [id, stream] of streams) {
    if (!activeIds.has(id)) {
      console.log(`stopping stream for session ${id} (no longer active)`);
      stream.stop();
      streams.delete(id);
    }
  }

  // Start a stream for every newly-active session.
  for (const session of sessions) {
    if (streams.has(session.id)) continue;
    console.log(`starting stream for session ${session.id} (${session.uber_org_uuid})`);
    const stream = new RamenStream(session);
    streams.set(session.id, stream);
    stream.run().catch((e) => console.error(`stream ${session.id} crashed: ${e.message}`));
  }
}

async function main() {
  console.log(`Ridy dispatch daemon starting -> ${config.apiBaseUrl}`);
  await reconcile();
  setInterval(reconcile, config.sessionPollInterval);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received, stopping ${streams.size} stream(s)...`);
    for (const stream of streams.values()) stream.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});
