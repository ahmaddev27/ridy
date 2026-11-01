// Turns a company's proxy URL (the one the daemon uses) into Playwright's `proxy`
// context option. Returns null for an empty/invalid value so the caller goes
// direct instead of failing: a company without a proxy keeps working as before.
export function parseProxyUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:", "socks5:"].includes(u.protocol) || !u.hostname) return null;
  const proxy = { server: `${u.protocol}//${u.host}` };
  if (u.username) proxy.username = decodeURIComponent(u.username);
  if (u.password) proxy.password = decodeURIComponent(u.password);
  return proxy;
}
