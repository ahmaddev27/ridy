// Reidey Uber Connector — one-click capture of the manager's real Uber session.
// No automation touches Uber (so it's never blocked): it reads the cookies of
// the session the manager already established, plus the fleet org, and posts
// them to Reidey with the pairing token.
//
// Pairing is handled ONLY by the dashboard (pair.js hands over the URL + token
// automatically). The popup deliberately has NO manual URL/token entry — the
// extension can't be pointed at an arbitrary backend or used without a token.

const api = globalThis.browser || globalThis["chrome"];
const $ = (id) => document.getElementById(id);

const DASHBOARD_URL = "https://reidey.de/connections";

// Backend reasons the manager can act on, in the popup's language (German).
const REASON_TEXT = {
  not_paired: "Nicht gekoppelt. Öffne zuerst dein Reidey-Dashboard.",
  unpaired: "Die Kopplung ist abgelaufen. Öffne dein Reidey-Dashboard, um neu zu koppeln.",
  no_org: "Keine Uber-Flotte gefunden. Melde dich bei fleethub.uber.com an und versuche es erneut.",
  no_cookies: "Keine Uber-Sitzung gefunden. Melde dich zuerst bei Uber an.",
  uber_org_already_linked: "Dieses Uber-Konto ist bereits mit einer anderen Firma verbunden.",
  company_inactive: "Deine Firma ist in Reidey derzeit nicht aktiv.",
  account_suspended: "Dein Reidey-Konto ist gesperrt. Bitte kontaktiere den Support.",
  not_connected: "Die Uber-Verbindung ist in Reidey getrennt. Verbinde sie im Dashboard neu.",
  autolink_blocked: "Die Uber-Verbindung wurde getrennt. Verbinde sie im Dashboard neu.",
  rate_limited: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
};

function reasonText(reason) {
  return REASON_TEXT[reason] || reason || "Verbindung fehlgeschlagen";
}

function setStatus(kind, message) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = message;
}

/** Show the paired or unpaired view based on whether the dashboard paired us. */
async function render() {
  const { apiUrl, token, backendPause } = await api.storage.local.get(["apiUrl", "token", "backendPause"]);
  const paired = Boolean(apiUrl && token);
  $("paired-view").classList.toggle("hidden", !paired);
  $("unpaired-view").classList.toggle("hidden", paired);
  if (paired && backendPause && backendPause.until > Date.now()) {
    setStatus("err", reasonText(backendPause.reason));
  }
}

/** The fleet org from a Fleet Hub URL (/orgs/<uuid>/…), or null. */
function orgUuidFromUrl(url) {
  const m = String(url || "").match(/\/orgs\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

async function connect() {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  if (!apiUrl || !token) return setStatus("err", reasonText("not_paired"));

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/(^|\.)uber\.com$/i.test(safeHost(tab.url))) {
    return setStatus("err", "Öffne zuerst fleethub.uber.com und melde dich an.");
  }

  setStatus("ok", "Sitzung wird erfasst…");

  // Only the /orgs/<uuid> URL names the fleet reliably; anywhere else the
  // background discovers it from the Fleet Hub redirect of this session.
  const res = await api.runtime.sendMessage({ type: "capture", orgUuid: orgUuidFromUrl(tab.url), manual: true });
  if (!res?.ok) return setStatus("err", reasonText(res?.reason));

  // Signing out the operator's OTHER Uber sessions is part of every Connect now —
  // no separate step. Uber runs the sign-out (via its own devices page) itself.
  setStatus("ok", "Verbunden ✓ — melde andere Uber-Sitzungen ab…");
  await api.runtime.sendMessage({ type: "evictSessions" }).catch(() => {});
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Forget the pairing on this browser (token, org, templates). Two clicks, since
 * window.confirm is unavailable in some browsers' extension popups.
 */
let unpairArmed = false;
async function unpair() {
  if (!unpairArmed) {
    unpairArmed = true;
    $("unpair").textContent = "Wirklich entkoppeln? Erneut klicken";
    return;
  }
  const res = await api.runtime.sendMessage({ type: "unpair" }).catch(() => null);
  if (!res?.ok) return setStatus("err", "Entkoppeln fehlgeschlagen");
  await render();
  setStatus("ok", "Entkoppelt ✓");
}

$("connect").addEventListener("click", connect);
$("unpair").addEventListener("click", unpair);
$("open-dashboard").addEventListener("click", () => api.tabs.create({ url: DASHBOARD_URL }));
render();
