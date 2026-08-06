// Ridy Uber Connector — one-click capture of the manager's real Uber session.
// No automation touches Uber (so it's never blocked): it reads the cookies of
// the session the manager already established, plus the org uuid from the page,
// and posts them to Ridy with the manager's pairing token.

const api = globalThis.browser || globalThis["chrome"];
const $ = (id) => document.getElementById(id);

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
  await api.storage.local.set({
    apiUrl: $("apiUrl").value.trim().replace(/\/$/, ""),
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
    return setStatus("err", "Bitte zuerst Ridy-URL und Token speichern.");
  }

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/uber\.com/i.test(tab.url || "")) {
    return setStatus("err", "Öffne zuerst vsdispatch.uber.com und melde dich an.");
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
