// Routes every outbound request (global fetch) through the configured residential
// proxy. Node's fetch is undici under the hood, so setting undici's global
// dispatcher to a ProxyAgent makes ack/recv/getDrivers all exit via the proxy.
// No-op when UBER_PROXY_URL is unset (direct connection — blocked by Uber).

import { ProxyAgent, setGlobalDispatcher } from "undici";
import { config } from "./config.js";

export function installProxy() {
  if (!config.proxyUrl) {
    console.warn(
      "no UBER_PROXY_URL set — Uber traffic goes direct from this server's IP, " +
        "which Uber blocks (RAMEN 404). Set a residential proxy for server-side streaming.",
    );
    return;
  }

  setGlobalDispatcher(new ProxyAgent(config.proxyUrl));
  // Log only the host:port, never the credentials.
  const safe = config.proxyUrl.replace(/\/\/[^@]*@/, "//***@");
  console.log(`routing Uber traffic through proxy: ${safe}`);
}
