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

  // Per-step wait budget (ms).
  stepTimeout: Number(process.env.UBER_AUTH_STEP_TIMEOUT || 30000),

  // A held login session is discarded after this idle time (ms).
  sessionTtl: Number(process.env.UBER_AUTH_SESSION_TTL || 300000),
};
