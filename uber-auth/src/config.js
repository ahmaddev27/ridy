function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.UBER_AUTH_PORT || 8791),

  // Shared secret; Laravel must send it as X-Auth-Secret.
  secret: required("UBER_AUTH_SECRET"),

  // Uber fleet dispatch dashboard — sign-in lands here.
  dashboardUrl: process.env.UBER_DASHBOARD_URL || "https://vsdispatch.uber.com/",

  // Run the browser visibly for local debugging (HEADFUL=1).
  headful: process.env.HEADFUL === "1",

  // Chromium's sandbox needs kernel support that many containers lack; set
  // NO_SANDBOX=1 there so Chrome launches with --no-sandbox (the container is the
  // isolation boundary instead). Never set this on a shared desktop.
  noSandbox: process.env.NO_SANDBOX === "1",

  // Per-step wait budget (ms).
  stepTimeout: Number(process.env.UBER_AUTH_STEP_TIMEOUT || 30000),

  // A held login session is discarded after this idle time (ms).
  sessionTtl: Number(process.env.UBER_AUTH_SESSION_TTL || 300000),

  // --- Persistent per-company session browsers ---------------------------------
  // The Reidey Laravel API this service pushes captures + status to.
  apiBaseUrl: process.env.RIDY_API_URL || "http://localhost:8090",
  // Shared secret the backend's internal/* endpoints expect (X-Dispatch-Secret).
  dispatchSecret: process.env.DISPATCH_INGEST_SECRET || "",
  // Keep-warm cadence (ms): a live browser is re-visited this often (default 6h,
  // well under jwt-session's 24h). An early keep-warm also fires when a token is
  // within warmBeforeExpiry of lapsing.
  warmIntervalMs: Number(process.env.WARM_INTERVAL_MS || 6 * 60 * 60 * 1000),
  warmBeforeExpiryMs: Number(process.env.WARM_BEFORE_EXPIRY_MS || 12 * 60 * 60 * 1000),
  // How often the tick loop checks for due sessions, and how often status is pushed.
  warmTickMs: Number(process.env.WARM_TICK_MS || 5 * 60 * 1000),
  statusPushMs: Number(process.env.STATUS_PUSH_MS || 20 * 1000),
  // Hard cap on concurrent live contexts on this box (RAM guard).
  maxSessions: Number(process.env.MAX_SESSIONS || 20),
  // Where each company's browser storage (cookies) is saved so a service restart
  // resumes warm without a fresh OTP, as long as the saved session is still valid.
  stateDir: process.env.STATE_DIR || "./state",

  // How often to poll the backend for the companies that should have a live
  // browser (active, connected sessions) and SEED a browser from the session the
  // company already connected on Uber — no password, no extra user step — then
  // close any browser whose company dropped out (subscription ended).
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS || 60000),
  // Gradual rollout: restrict the auto-seed to these tenant ids (comma-separated);
  // empty = every active company. e.g. ONLY_TENANTS=8 to start with one company.
  onlyTenants: (process.env.ONLY_TENANTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
