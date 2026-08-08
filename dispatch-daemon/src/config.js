// Central config, read from the environment so nothing secret is hard-coded.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  // Ridy Laravel API base, e.g. http://localhost:8090
  apiBaseUrl: (process.env.RIDY_API_URL || "http://localhost:8090").replace(/\/$/, ""),

  // Shared secret matching backend DISPATCH_INGEST_SECRET.
  dispatchSecret: required("DISPATCH_INGEST_SECRET"),

  // Uber RAMEN dispatch stream host.
  uberDispatchBase: (process.env.UBER_DISPATCH_BASE_URL || "https://vsdispatch.uber.com").replace(/\/$/, ""),
  ramenPath: process.env.UBER_RAMEN_PATH || "/ramendca/events",

  // Uber supplier host — the driver roster (/api/getDrivers) lives here.
  uberSupplierBase: (process.env.UBER_SUPPLIER_BASE_URL || "https://supplier.uber.com").replace(/\/$/, ""),

  // How often to re-pull the roster (ms). Default 30 min.
  rosterInterval: Number(process.env.ROSTER_INTERVAL_MS || 1800000),

  // How often to re-read the active session list from the backend (ms).
  sessionPollInterval: Number(process.env.SESSION_POLL_INTERVAL_MS || 60000),

  // Reconnect backoff bounds (ms).
  reconnectMinDelay: Number(process.env.RECONNECT_MIN_MS || 2000),
  reconnectMaxDelay: Number(process.env.RECONNECT_MAX_MS || 60000),
};
