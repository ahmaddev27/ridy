// Stored cookies are just {name,value} — the host scope was stripped on capture —
// so re-attach each jar to the host it belongs to: the RAMEN jar to vsdispatch,
// the supplier jar to fleethub. Playwright infers domain/path/secure from the url.
export const RAMEN_SCOPE_URL = "https://vsdispatch.uber.com/";
export const SUPPLIER_SCOPE_URL = "https://fleethub.uber.com/";

function toPlaywrightCookies(list, url) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => ({ name: c.name, value: c.value, url }));
}

/** Both jars as Playwright cookies ready for context.addCookies(). */
export function scopeCookies(cookies, supplierCookies) {
  return [...toPlaywrightCookies(cookies, RAMEN_SCOPE_URL), ...toPlaywrightCookies(supplierCookies, SUPPLIER_SCOPE_URL)];
}
