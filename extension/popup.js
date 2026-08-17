// Reidey Uber Connector — one-click capture of the manager's real Uber session.
// No automation touches Uber (so it's never blocked): it reads the cookies of
// the session the manager already established, plus the org uuid from the page,
// and posts them to Reidey with the manager's pairing token.

const api = globalThis.browser || globalThis["chrome"];
const $ = (id) => document.getElementById(id);

// Keep in sync with background.js — the backend host must be allowlisted, and
// reidey.de must be https (localhost/127.0.0.1 may be http for local dev).
const ALLOWED_API_HOSTS = ["reidey.de", "localhost", "127.0.0.1"];

function isAllowedApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!ALLOWED_API_HOSTS.includes(parsed.hostname)) return false;
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocal) return parsed.protocol === "http:" || parsed.protocol === "https:";
  return parsed.protocol === "https:";
}

function setStatus(kind, message) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = message;
}

async function loadSettings() {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  $("apiUrl").value = apiUrl || "";
  $("token").value = token || "";
  // First run with nothing configured: open settings so it's obvious.
  if (!apiUrl || !token) $("settings").open = true;
  return { apiUrl, token };
}

$("save").addEventListener("click", async () => {
  const apiUrl = $("apiUrl").value.trim().replace(/\/$/, "");
  if (!isAllowedApiUrl(apiUrl)) {
    return setStatus("err", "Ungültige Reidey-URL. Nur https://reidey.de ist erlaubt.");
  }
  await api.storage.local.set({
    apiUrl,
    token: $("token").value.trim(),
    // Re-pairing (new URL/token) must force a fresh capture next time.
    lastSync: null,
  });
  setStatus("ok", "Einstellungen gespeichert.");
});

/** Pull the logged-in fleet account's uuid (= org / partnerUUID) from the page. */
function extractOrgUuidInPage() {
  const html = document.documentElement.innerHTML;
  const m =
    html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) ||
    html.match(/"uuid":"([0-9a-f-]{36})"/i);
  return m ? m[1] : null;
}

async function connect() {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  if (!apiUrl || !token) {
    $("settings").open = true;
    return setStatus("err", "Bitte zuerst Reidey-URL und Token speichern.");
  }

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/uber\.com/i.test(tab.url || "")) {
    return setStatus("err", "Öffne zuerst supplier.uber.com und melde dich an.");
  }

  setStatus("ok", "Sitzung wird erfasst…");

  // Org uuid from the active Uber tab.
  let orgUuid = null;
  try {
    const [res] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractOrgUuidInPage,
    });
    orgUuid = res?.result ?? null;
  } catch {
    /* falls through to the error below */
  }
  if (!orgUuid) {
    return setStatus("err", "Org-UUID nicht gefunden. Öffne das Dispatch-Dashboard und versuche es erneut.");
  }

  // Delegate to the background worker so capture logic lives in one place.
  const res = await api.runtime.sendMessage({ type: "capture", orgUuid, manual: true });
  if (res?.ok) {
    setStatus("ok", `Verbunden ✓ (${res.count ?? "aktualisiert"})`);
  } else {
    setStatus("err", res?.reason || "Verbindung fehlgeschlagen");
  }
}

$("connect").addEventListener("click", connect);
loadSettings();
