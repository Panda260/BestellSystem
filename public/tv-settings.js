const DEFAULTS = {
  bgColor: "#2a2a2a",
  boxWaiting: "#e5e7eb",
  boxOven: "#fef3c7",
  boxReady: "#d1fae5",
  tagOven: "#f59e0b",
  tagReady: "#10b981",
  textWaiting: "#1f2937",
  textOven: "#92400e",
  textReady: "#065f46",
  titleColor: "#f0f0f0",
  clockColor: "#0b1220",
};

let current = {};

async function loadSettings() {
  try {
    const res = await fetch("/api/tv-settings");
    if (!res.ok) return;
    current = await res.json();
    applyToPickers();
  } catch (_) {}
}

function applyToPickers() {
  document.querySelectorAll(".color-picker-row input[type=color]").forEach((input) => {
    const key = input.dataset.key;
    input.value = current[key] || DEFAULTS[key] || "#000000";
  });
}

document.querySelectorAll(".color-picker-row input[type=color]").forEach((input) => {
  input.addEventListener("input", async () => {
    const key = input.dataset.key;
    const value = input.value;
    current[key] = value;
    try {
      await fetch("/api/tv-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      showSaved();
    } catch (_) {}
  });
});

document.getElementById("tv-settings-reset").addEventListener("click", async () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    try {
      await fetch("/api/tv-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch (_) {}
  }
  current = { ...DEFAULTS };
  applyToPickers();
  showSaved();
});

function showSaved() {
  const el = document.getElementById("tv-settings-saved");
  if (!el) return;
  el.style.opacity = "1";
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => { el.style.opacity = "0"; }, 1500);
}

loadSettings();
