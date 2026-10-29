// The outbound command loop: long-poll the backend for dispatch commands, run
// each one on the stream that already holds that company's vsdispatch session,
// and report Uber's answer back.
//
// WHY a long-poll and not a listener: the daemon stays 100% OUTBOUND. It holds
// every company's decrypted Uber cookies, and docker-compose.daemon-shard.yml runs
// shards on a separate box that can only reach the backend — never the reverse. So
// the backend cannot push a decline to us; we park a GET on it instead, which also
// gives near-push latency without a socket anyone could connect to.
//
// Independent of the 60s reconcile loop on purpose: a decline is worthless a
// minute late, and a slow session poll must never hold one up.

import { config } from "./config.js";
import { api, isTransientConnect } from "./api.js";
import { streams } from "./supervisor.js";
import { captureThrottled } from "./sentry.js";
import { jitter, nextThrottleDelay } from "./util.js";

// After this many consecutive long-poll failures, fall back to a short poll. A
// broken park — a proxy or load balancer that cuts the parked request, a backend
// that does not know the route yet — must mean "the decline is a few hundred ms
// late", never "there is no decline at all".
const LONG_POLL_FAIL_THRESHOLD = 2;
const SHORT_POLL_DELAY_MS = 400;

// Once even the short poll keeps failing (the backend is down), back off so a
// dead API is not hammered 2.5 times a second per shard.
const FAIL_BACKOFF_MIN_MS = 1000;
const FAIL_BACKOFF_MAX_MS = 30000;

let running = false;
let stopped = false;
let failures = 0;
let backoffMs = 0;
let sleepTimer = null;

/** Long-polling is the normal mode; repeated failures drop us to the short poll. */
function longPolling() {
  return failures < LONG_POLL_FAIL_THRESHOLD;
}

function sleep(ms) {
  return new Promise((resolve) => {
    sleepTimer = setTimeout(resolve, ms);
    sleepTimer.unref?.(); // a pending wait must never hold the process open on shutdown
  });
}

/**
 * One poll. In long-poll mode the backend parks until a command is claimable; in
 * short-poll mode we ask for an immediate answer and pace ourselves, because
 * whatever cut the park would cut it again every cycle.
 */
async function poll() {
  if (longPolling()) {
    return api.commands(Math.round(config.commandPollWait / 1000));
  }
  const commands = await api.commands(0);
  if (commands.length === 0) await sleep(SHORT_POLL_DELAY_MS);
  return commands;
}

/**
 * The stream holding this session's vsdispatch cookies. The PRIMARY channel is
 * preferred because it owns cookie persistence, so its jar is the freshest — but
 * ANY live channel of the session authenticates on the same host. Without the
 * fallback a stopped primary with a live secondary would report "no stream" while
 * that session's offers are visibly still arriving.
 */
export function streamFor(sessionId) {
  if (sessionId === undefined || sessionId === null) return null;
  const primary = streams.get(`${sessionId}:${config.ramenPaths[0]}`);
  if (primary && !primary.stopped) return primary;
  for (const [key, stream] of streams) {
    if (key.startsWith(`${sessionId}:`) && !stream.stopped) return stream;
  }
  return null;
}

/**
 * Execute one claimed command and report the outcome. A FAILURE is reported just
 * as faithfully as a success: the backend leaves the offer pending on a failure,
 * and a silent drop would leave the driver's pop-up waiting on a verdict that
 * never comes.
 */
export async function handleCommand(command) {
  const stream = streamFor(command?.session_id);
  if (!stream) {
    // The shard may have been rebalanced between the claim and now.
    await report(command?.id, {
      isSuccess: false,
      errorMsg: `no live stream for session ${command?.session_id}`,
      latencyMs: 0,
    });
    return;
  }

  let result;
  try {
    result = await stream.dispatchAction({
      action: command.action,
      offerUUID: command.offer_uuid,
      realOfferUUID: command.real_offer_uuid,
      offerType: command.offer_type,
      driverUUID: command.driver_uuid,
    });
  } catch (e) {
    // dispatchAction resolves for every outcome by design, but a bug in it must
    // still not leave the command hanging until it expires.
    result = { isSuccess: null, errorMsg: e.message, latencyMs: null };
  }

  console.log(
    `dispatch ${command.action} ${command.offer_uuid} -> ` +
      `${result.isSuccess === true ? "ok" : `failed (${result.errorMsg || "no reason"})`} in ${result.latencyMs}ms`,
  );
  await report(command.id, result);
}

async function report(commandId, result) {
  if (!Number.isFinite(Number(commandId))) return;
  try {
    await api.commandResult(commandId, result);
  } catch (e) {
    // Retrying here would hold the loop off the next command, which is already
    // racing a deadline; the backend expires an unanswered command on its own.
    console.error(`dispatch command ${commandId}: result not reported: ${e.message}`);
    if (!isTransientConnect(e)) {
      captureThrottled("command-result", e, { where: "command_result", commandId });
    }
  }
}

async function loop() {
  while (!stopped) {
    let commands;
    try {
      commands = await poll();
      failures = 0;
      backoffMs = 0;
    } catch (e) {
      failures++;
      // The first couple of failures are usually the backend restarting mid-park
      // during a deploy: retry quickly (and in short-poll mode from here on, which
      // no idle timeout can cut). Only sustained failure backs off.
      let delay = SHORT_POLL_DELAY_MS;
      if (failures > LONG_POLL_FAIL_THRESHOLD) {
        backoffMs = nextThrottleDelay(backoffMs, 0, FAIL_BACKOFF_MIN_MS, FAIL_BACKOFF_MAX_MS);
        delay = jitter(backoffMs);
      }
      console.error(`dispatch command poll failed (${failures}): ${e.message}; retrying in ${delay}ms`);
      // A deploy's Caddy-recreate blip refuses the long-poll for a few seconds;
      // it self-heals on the next poll, so don't escalate transient blips to
      // Sentry — only report a sustained, non-transient failure.
      if (!isTransientConnect(e) || failures > LONG_POLL_FAIL_THRESHOLD) {
        captureThrottled("command-poll", e, { where: "command_poll", consecutiveFailures: failures });
      }
      if (!stopped) await sleep(delay);
      continue;
    }

    // Run the batch concurrently: two companies' declines must not queue behind
    // each other, and each one is already racing Uber. Settled, not awaited for a
    // result — handleCommand reports its own outcome and never rejects.
    if (commands.length > 0) await Promise.allSettled(commands.map((c) => handleCommand(c)));
  }
  running = false;
}

/** Start the loop (idempotent). Resolves immediately; the loop runs detached. */
export function startCommandLoop() {
  if (!config.commandsEnabled) {
    console.log("dispatch command loop disabled (COMMANDS_ENABLED=false) — no panel declines on this shard");
    return;
  }
  if (running) return;
  running = true;
  stopped = false;
  failures = 0;
  backoffMs = 0;
  // loop() swallows its own errors, but an unhandled rejection here would take
  // the whole daemon down with it — offers included.
  loop().catch((e) => {
    running = false;
    console.error(`dispatch command loop stopped: ${e.message}`);
    captureThrottled("command-loop", e, { where: "command_loop" });
  });
}

/** Stop polling on SIGTERM/SIGINT. The in-flight poll is left to settle. */
export function stopCommandLoop() {
  stopped = true;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
}
