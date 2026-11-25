// Live-Verbindungsanzeige: Banner oben, solange die WebSocket-Verbindung weg ist.
// Nutzung auf einer Seite: watchConnection(socket);
// Außerdem: Auto-Reload nach einem Update (watchAppVersion, in watchConnection enthalten).
// Eine Seite kann das Neuladen aufschieben: window.appReloadBlocked = () => true;
(function () {
  const GRACE_MS = 2000; // kurze Aussetzer (Seitenwechsel, Reconnect) nicht anzeigen
  const BACK_MS = 2500; // wie lange "Wieder verbunden" sichtbar bleibt

  function getBanner() {
    let el = document.getElementById("conn-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "conn-banner";
      el.className = "conn-banner";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }

  // ---- Auto-Reload nach Update ----
  const pageVersion = document.querySelector('meta[name="app-version"]')?.content || "";
  let pendingReload = false;

  function reloadWhenFree() {
    const blocked = typeof window.appReloadBlocked === "function" && window.appReloadBlocked();
    if (!blocked) {
      window.location.reload();
      return;
    }
    if (!pendingReload) {
      pendingReload = true;
      const el = getBanner();
      el.className = "conn-banner update";
      el.textContent = "Neue Version installiert – Seite lädt nach dieser Bestellung neu.";
      // erneut prüfen, sobald die Eingabe abgeschlossen ist
      const iv = setInterval(() => {
        if (!window.appReloadBlocked()) {
          clearInterval(iv);
          window.location.reload();
        }
      }, 2000);
    }
  }

  window.watchAppVersion = function (socket) {
    socket.on("app:version", (serverVersion) => {
      if (pageVersion && serverVersion && serverVersion !== pageVersion) reloadWhenFree();
    });
  };

  window.watchConnection = function (socket) {
    window.watchAppVersion(socket);
    let downTimer = null;
    let hideTimer = null;
    let shownDown = false;

    function scheduleDown() {
      if (downTimer || shownDown) return;
      downTimer = setTimeout(() => {
        downTimer = null;
        if (socket.connected) return;
        shownDown = true;
        clearTimeout(hideTimer);
        const el = getBanner();
        el.className = "conn-banner down";
        el.textContent = "Keine Live-Verbindung zum Server – Anzeige ist evtl. nicht aktuell. Verbinde neu …";
      }, GRACE_MS);
    }

    socket.on("connect", () => {
      clearTimeout(downTimer);
      downTimer = null;
      if (!shownDown || pendingReload) return;
      shownDown = false;
      const el = getBanner();
      el.className = "conn-banner up";
      el.textContent = "Wieder verbunden";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!pendingReload) el.className = "conn-banner"; // Update-Hinweis stehen lassen
      }, BACK_MS);
    });
    socket.on("disconnect", scheduleDown);
    socket.on("connect_error", scheduleDown);

    // Kommt die erste Verbindung gar nicht erst zustande
    if (!socket.connected) scheduleDown();
  };
})();
