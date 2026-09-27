/**
 * Reduce a server-supplied link (notification / push `href`) to an app-relative
 * path on our own origin, or null. Rejects `javascript:`, `data:`, protocol-
 * relative `//host` and any other origin, so a stored href can never run script
 * or bounce the user off-site.
 */
export function safeHref(href: unknown, origin?: string): string | null {
  if (typeof href !== "string" || href.trim() === "") return null;
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  try {
    const url = new URL(href, base);
    if (url.origin !== new URL(base).origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
