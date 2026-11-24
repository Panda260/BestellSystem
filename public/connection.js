// Live-Verbindungsanzeige: Banner oben, solange die WebSocket-Verbindung weg ist.
// Nutzung auf einer Seite: watchConnection(socket);
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

  window.watchConnection = function (socket) {
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
      if (!shownDown) return;
      shownDown = false;
      const el = getBanner();
      el.className = "conn-banner up";
      el.textContent = "Wieder verbunden";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { el.className = "conn-banner"; }, BACK_MS);
    });
    socket.on("disconnect", scheduleDown);
    socket.on("connect_error", scheduleDown);

    // Kommt die erste Verbindung gar nicht erst zustande
    if (!socket.connected) scheduleDown();
  };
})();
