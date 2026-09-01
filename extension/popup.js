// Reidey Uber Connector — one-click capture of the manager's real Uber session.
// No automation touches Uber (so it's never blocked): it reads the cookies of
// the session the manager already established, plus the org uuid from the page,
// and posts them to Reidey with the pairing token.
//
// Pairing is handled ONLY by the dashboard (pair.js hands over the URL + token
// automatically). The popup deliberately has NO manual URL/token entry — the
// extension can't be pointed at an arbitrary backend or used without a token.

const api = globalThis.browser || globalThis["chrome"];
const $ = (id) => document.getElementById(id);

const DASHBOARD_URL = "https://reidey.de/connections";

function setStatus(kind, message) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = message;
}

/** Show the paired or unpaired view based on whether the dashboard paired us. */
async function render() {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  const paired = Boolean(apiUrl && token);
  $("paired-view").classList.toggle("hidden", !paired);
  $("unpaired-view").classList.toggle("hidden", paired);
}

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
    return setStatus("err", "Nicht gekoppelt. Öffne zuerst dein Reidey-Dashboard.");
  }

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/uber\.com/i.test(tab.url || "")) {
    return setStatus("err", "Öffne zuerst fleethub.uber.com und melde dich an.");
  }

  setStatus("ok", "Sitzung wird erfasst…");

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

  const res = await api.runtime.sendMessage({ type: "capture", orgUuid, manual: true });
  if (res?.ok) {
    setStatus("ok", `Verbunden ✓ (${res.count ?? "aktualisiert"})`);
  } else {
    setStatus("err", res?.reason || "Verbindung fehlgeschlagen");
  }
}

$("connect").addEventListener("click", connect);
$("open-dashboard").addEventListener("click", () => api.tabs.create({ url: DASHBOARD_URL }));
render();
