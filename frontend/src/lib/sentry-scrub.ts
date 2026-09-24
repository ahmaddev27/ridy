// Query parameters that carry credentials or one-time secrets (driver invite
// token on /driver/activate, OTP/reset codes). Never sent to error monitoring.
const SECRET_PARAMS = /^(token|otp|code|password|reset|invite|signature|key)$/i;

/** Replace secret query-parameter values in a URL (absolute, relative or bare query) with "[redacted]". */
export function scrubUrl(url: string): string {
  if (!url || !url.includes("?") && !url.includes("=")) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf("?");
  const base = qAt >= 0 ? noHash.slice(0, qAt + 1) : "";
  const query = qAt >= 0 ? noHash.slice(qAt + 1) : noHash;
  const scrubbed = query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const name = decodeURIComponentSafe(pair.slice(0, eq));
      return SECRET_PARAMS.test(name) ? `${pair.slice(0, eq)}=[redacted]` : pair;
    })
    .join("&");
  return `${base}${scrubbed}${hash}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
