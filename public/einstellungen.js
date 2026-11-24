document.querySelectorAll(".toggle-row input[type=checkbox]").forEach((input) => {
  input.addEventListener("change", async () => {
    const key = input.dataset.key;
    const value = input.checked ? "1" : "0";
    input.disabled = true;
    try {
      const res = await fetch("/api/tv-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("save failed");
      showSaved("Gespeichert!");
    } catch (_) {
      input.checked = !input.checked; // Zustand zurücksetzen, wenn nicht gespeichert
      showSaved("Speichern fehlgeschlagen");
    } finally {
      input.disabled = false;
    }
  });
});

function showSaved(text) {
  const el = document.getElementById("settings-saved");
  if (!el) return;
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => { el.style.opacity = "0"; }, 1500);
}
