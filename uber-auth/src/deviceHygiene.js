// Uber device-session hygiene, PHASE A: DRY-RUN ONLY (read-only).
//
// Opens the account devices list in a SEPARATE page, parses the rows, classifies them and LOGS
// what a later phase WOULD sign out. It clicks nothing, confirms no dialog and changes nothing.
// There is deliberately NO signout code path in this file (no click, no /api/deviceSignout call,
// no bulk "sign out all" control): real signout is a later phase gated on this data + owner OK.

export const DEVICES_URL = "https://account.uber.com/devices";
const AUTH_RE = /auth\.uber\.com|\/login|signin|loginEntry/i;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const ACTION = { PROTECT: "protect-current", WOULD_SIGNOUT: "would-signout", SKIP: "skip" };
export const STATUS = {
  DONE: "done",
  ABORT_NOT_AUTHENTICATED: "abort_not_authenticated",
  ABORT_NO_ROWS: "abort_no_rows",
  ABORT_NO_CURRENT_MARKER: "abort_no_current_marker",
  ERROR: "error",
};

// DE / EN / AR wording for the "this is the login you are using right now" badge.
const CURRENT_RE = /your current (login|session|device)|current (login|session|device)|this device|aktuelle[rs]? (anmeldung|sitzung|ger[aä]t)|dieses ger[aä]t|ihre aktuelle|تسجيل الدخول الحالي|الجلسة الحالية|جلستك الحالية|هذا الجهاز|جهازك الحالي/i;
const PLATFORM_RE = /([A-Za-z][\w .+-]{1,40}?)\s+(?:on|auf|unter)\s+([A-Za-z][\w .+-]{1,30})/i;
const AGO_RE = /(\d+)\s*(minute|min|hour|stunde|std|day|tag|week|woche|month|monat)/i;

export const DEFAULT_CTX = Object.freeze({
  signatures: ["Chrome on Linux"],
  regions: [],
  staleAfterMs: 2 * DAY,
});

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const lower = (s) => norm(s).toLowerCase();

/** "3 days ago" / "vor 2 Stunden" -> ms; "now"/"jetzt" -> 0; unrecognised -> null. */
export function parseAgeMs(text) {
  const t = lower(text);
  if (!t) return null;
  if (/active now|just now|now|jetzt|gerade|الآن/.test(t)) return 0;
  const m = AGO_RE.exec(t);
  if (!m) return null;
  const unit = m[2];
  const n = Number(m[1]);
  if (/^min/.test(unit)) return n * 60_000;
  if (/^(hour|stunde|std)/.test(unit)) return n * HOUR;
  if (/^(day|tag)/.test(unit)) return n * DAY;
  if (/^(week|woche)/.test(unit)) return n * 7 * DAY;
  return n * 30 * DAY;
}

/** Pure: raw row text -> Row. */
export function parseRowText(text) {
  // Keep line breaks: each visual line is one field, so "Chrome on Linux" never swallows the city.
  const lines = String(text ?? "").split(/\r?\n|\s·\s|\s•\s/).map(norm).filter(Boolean);
  const raw = lines.join(" | ");
  const platform = lines.map((l) => PLATFORM_RE.exec(l)).find(Boolean);
  const location = /([A-ZÄÖÜ][\p{L} .'-]+,\s*[A-ZÄÖÜ][\p{L} .'-]+)/u.exec(raw);
  const lastActive = /((?:vor\s+)?\d+\s*\p{L}+\s*(?:ago)?|active now|just now|jetzt|gerade eben)/iu.exec(raw);
  return {
    platform: platform ? norm(platform[0]) : null,
    location: location ? norm(location[1]) : null,
    lastActive: lastActive ? norm(lastActive[1]) : null,
    isCurrent: CURRENT_RE.test(raw),
    raw: raw.slice(0, 160),
  };
}

const platformAllowed = (row, ctx) =>
  row.platform != null && ctx.signatures.some((s) => lower(row.platform) === lower(s));
const regionAllowed = (row, ctx) =>
  ctx.regions.length === 0 || (row.location != null && ctx.regions.some((r) => lower(row.location).includes(lower(r))));

function staleVerdict(row, ctx) {
  if (!row.lastActive) return { ok: true, note: "no_last_active_shown" };
  const age = parseAgeMs(row.lastActive);
  if (age == null) return { ok: false, note: "last_active_unparsed" };
  return age >= ctx.staleAfterMs ? { ok: true, note: "stale" } : { ok: false, note: "recently_active" };
}

/** PURE. Conservative allowlist: anything not positively matched is skipped. Never targets the current login. */
export function classifyRow(row, ctx = DEFAULT_CTX) {
  const c = { ...DEFAULT_CTX, ...ctx };
  if (row.isCurrent) return { action: ACTION.PROTECT, reason: "current_login" };
  if (!platformAllowed(row, c)) return { action: ACTION.SKIP, reason: "platform_not_in_allowlist" };
  if (!regionAllowed(row, c)) return { action: ACTION.SKIP, reason: "region_not_allowed" };
  const stale = staleVerdict(row, c);
  if (!stale.ok) return { action: ACTION.SKIP, reason: stale.note };
  return { action: ACTION.WOULD_SIGNOUT, reason: `scraper_signature+${stale.note}` };
}

/** Reads candidate row texts off the page (read-only DOM query; no interaction). */
async function readRowTexts(page) {
  return page.evaluate(() => {
    const sel = '[role="listitem"], li, tr, [data-testid*="device" i], [data-testid*="session" i]';
    const texts = [...document.querySelectorAll(sel)].map((e) => (e.innerText || "").trim());
    return texts.filter((t) => t && t.length < 400);
  });
}

/** Navigates the (separate) page to the devices list and parses it. Throws on a login redirect. */
export async function parseDeviceRows(page) {
  await page.goto(DEVICES_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 10_000 }).catch(() => {});
  if (AUTH_RE.test(page.url()) || !/account\.uber\.com/.test(page.url())) {
    const err = new Error("not_authenticated");
    err.code = STATUS.ABORT_NOT_AUTHENTICATED;
    throw err;
  }
  const rows = (await readRowTexts(page)).map(parseRowText).filter((r) => r.platform || r.isCurrent);
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.raw) ? false : seen.add(r.raw)));
}

const brief = (c) => ({ platform: c.row.platform, location: c.row.location, lastActive: c.row.lastActive, reason: c.reason });

function abort(log, status, extra) {
  log(`ABORT ${status} ${JSON.stringify(extra)}`);
  return { status, dryRun: true, ...extra };
}

function summarize(rows, ctx) {
  const all = rows.map((row) => ({ row, ...classifyRow(row, ctx) }));
  const pick = (a) => all.filter((c) => c.action === a).map(brief);
  return { wouldSignout: pick(ACTION.WOULD_SIGNOUT), protected: pick(ACTION.PROTECT), skipped: pick(ACTION.SKIP) };
}

/**
 * DRY-RUN. Parse, classify, log. Aborts when the page is not authenticated or no row carries the
 * current-login marker (layout not understood). Never clicks, never throws.
 * deps: { parse = parseDeviceRows, ctx, log }
 */
export async function runHygiene(page, deps = {}) {
  const { parse = parseDeviceRows, ctx = DEFAULT_CTX, log = () => {} } = deps;
  try {
    const rows = await parse(page);
    if (rows.length === 0) return abort(log, STATUS.ABORT_NO_ROWS, { total: 0 });
    if (!rows.some((r) => r.isCurrent)) return abort(log, STATUS.ABORT_NO_CURRENT_MARKER, { total: rows.length });
    const result = { status: STATUS.DONE, dryRun: true, total: rows.length, ...summarize(rows, ctx) };
    log(`dry-run total=${result.total} would_signout=${result.wouldSignout.length} protected=${result.protected.length} skipped=${result.skipped.length} ${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    return abort(log, e?.code === STATUS.ABORT_NOT_AUTHENTICATED ? e.code : STATUS.ERROR, { error: e?.message });
  }
}
