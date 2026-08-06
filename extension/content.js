// Runs on vsdispatch.uber.com / supplier.uber.com. Watches for a logged-in
// state and, once the manager has finished signing in, asks the background
// worker to capture the session automatically — no button press needed.

(function ridyAutoCapture() {
  const api = globalThis.browser || globalThis["chrome"];
  let done = false;

  function findOrgUuid() {
    const html = document.documentElement.innerHTML;
    const m =
      html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) ||
      html.match(/"uuid":"([0-9a-f-]{36})"/i);
    return m ? m[1] : null;
  }

  function toast(message, ok) {
    const el = document.createElement("div");
    el.textContent = message;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: 2147483647,
      padding: "10px 14px",
      borderRadius: "8px",
      font: "600 13px system-ui, sans-serif",
      color: "#fff",
      background: ok ? "#059669" : "#dc2626",
      boxShadow: "0 4px 12px rgba(0,0,0,.2)",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function tryCapture() {
    if (done) return;
    const orgUuid = findOrgUuid();
    if (!orgUuid) return; // not logged in yet

    done = true; // attempt once per page load
    const res = await api.runtime.sendMessage({ type: "capture", orgUuid });

    if (res?.ok) {
      // Confirm whether it was freshly captured or already connected.
      toast(
        res.reason === "unchanged" ? "Ridy: bereits verbunden ✓" : "Ridy: Uber-Sitzung verbunden ✓",
        true,
      );
    } else if (res && !res.ok) {
      done = false; // allow a later retry (e.g. after pairing)
      if (res.reason === "not_paired") {
        toast("Ridy: Bitte zuerst die Erweiterung im Dashboard koppeln.", false);
      } else if (res.reason !== "no_cookies") {
        toast(`Ridy: ${res.reason}`, false);
      }
    }
  }

  // Poll briefly after load — the dashboard hydrates its user data asynchronously.
  const started = Date.now();
  const timer = setInterval(() => {
    tryCapture();
    if (done || Date.now() - started > 60000) clearInterval(timer);
  }, 1500);
})();
