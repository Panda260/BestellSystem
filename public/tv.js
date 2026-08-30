const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
const listEl = document.getElementById("tv-list");

socket.emit("join", { role: "tv" });

// Re-join room on reconnect
socket.on("connect", () => {
  socket.emit("join", { role: "tv" });
  hideStatus();
});

socket.on("disconnect", () => {
  showStatus("Verbindung verloren — versuche erneut...");
});

socket.on("connect_error", () => {
  showStatus("Server nicht erreichbar — versuche erneut...");
});

function showStatus(msg) {
  let el = document.getElementById("tv-conn-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "tv-conn-status";
    el.className = "tv-conn-status";
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

function hideStatus() {
  const el = document.getElementById("tv-conn-status");
  if (el) el.remove();
}

// ---- TV Color Settings ----
const TV_DEFAULTS = {
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

let tvColors = { ...TV_DEFAULTS };

async function loadTvColors() {
  try {
    const res = await fetch("/api/tv-settings");
    if (!res.ok) return;
    const settings = await res.json();
    tvColors = { ...TV_DEFAULTS, ...settings };
    applyTvColors();
  } catch (_) {}
}

function applyTvColors() {
  const root = document.documentElement;
  root.style.setProperty("--tv-bg", tvColors.bgColor);
  root.style.setProperty("--tv-box-waiting", tvColors.boxWaiting);
  root.style.setProperty("--tv-box-oven", tvColors.boxOven);
  root.style.setProperty("--tv-box-ready", tvColors.boxReady);
  root.style.setProperty("--tv-tag-oven", tvColors.tagOven);
  root.style.setProperty("--tv-tag-ready", tvColors.tagReady);
  root.style.setProperty("--tv-text-waiting", tvColors.textWaiting);
  root.style.setProperty("--tv-text-oven", tvColors.textOven);
  root.style.setProperty("--tv-text-ready", tvColors.textReady);
  root.style.setProperty("--tv-title-color", tvColors.titleColor);
  root.style.setProperty("--tv-clock-color", tvColors.clockColor);
}

// Listen for settings updates via socket
socket.on("tv-settings:update", () => {
  loadTvColors();
});

loadTvColors();

socket.on("orders:update", (orders) => {
  renderTV(orders);
});

window.addEventListener("resize", () => {
  fitBoxes();
});

// German clock
const clockEl = document.getElementById("tv-clock");
function updateClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
updateClock();
setInterval(updateClock, 1000);

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderTV(orders) {
  const active = orders.filter((o) => !o.pickedUp);

  // Compute item-level status for each order (ignoring picked-up items)
  const withStatus = active.map((o) => {
    const remaining = o.items.filter((i) => !i.pickedUp);
    const total = remaining.length;
    const doneCount = remaining.filter((i) => i.done).length;
    const ovenCount = remaining.filter((i) => i.inOven).length;

    // Any item done -> ready (Abholbereit), ignore oven
    // No item done but some in oven -> in oven
    // Otherwise -> waiting
    let status;
    if (total === 0) {
      status = "ready";
    } else if (doneCount > 0) {
      status = "ready";
    } else if (ovenCount > 0) {
      status = "in-oven";
    } else {
      status = "waiting";
    }

    return { order: o, status, total, doneCount, ovenCount };
  });

  // Sort: 1) ready first, 2) in-oven, 3) waiting — each by createdAt asc
  const statusOrder = { ready: 0, "in-oven": 1, waiting: 2 };
  const sorted = withStatus.sort((a, b) => {
    const sa = statusOrder[a.status];
    const sb = statusOrder[b.status];
    if (sa !== sb) return sa - sb;
    return new Date(a.order.createdAt) - new Date(b.order.createdAt);
  });

  if (!sorted.length) {
    listEl.innerHTML = '<div class="tv-empty">Keine Bestellungen</div>';
    return;
  }

  listEl.innerHTML = sorted.map(({ order: o, status, total, doneCount, ovenCount }) => {
    const name = escapeHtml(o.customerName || "");
    const showCount = total > 1;

    let cls = "tv-box waiting";
    let tag = "";
    let count = "";
    if (status === "ready") {
      cls = "tv-box ready";
      tag = '<span class="tv-tag ready">Abholbereit</span>';
      if (showCount) count = `<span class="tv-count">${doneCount}/${total}</span>`;
    } else if (status === "in-oven") {
      cls = "tv-box in-oven";
      tag = '<span class="tv-tag oven">Im Ofen</span>';
      if (showCount) count = `<span class="tv-count">${ovenCount}/${total}</span>`;
    }

    return `
      <div class="${cls}">
        <span class="tv-box-name">${name}</span>
        ${tag}
        ${count}
      </div>
    `;
  }).join("");

  fitBoxes();
}

// Dynamically scale boxes so everything fits without scrolling
function fitBoxes() {
  const boxes = listEl.querySelectorAll(".tv-box");
  if (!boxes.length) return;

  const pad = 24;
  const gap = 10;
  const availW = window.innerWidth - pad * 2;
  const availH = window.innerHeight - pad * 2 - 50; // minus title
  const n = boxes.length;

  // Find the layout with the largest square-ish boxes that fit
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Box size = limited by both width and height — make them square
    const maxBoxW = (availW - gap * (cols - 1)) / cols;
    const maxBoxH = (availH - gap * (rows - 1)) / rows;
    const boxSize = Math.min(maxBoxW, maxBoxH);
    if (boxSize < 80) continue;
    if (!best || boxSize > best.boxSize) {
      best = { cols, rows, boxSize };
    }
  }
  if (!best) best = { cols: 1, rows: n, boxSize: 80 };

  const size = best.boxSize;
  listEl.style.gridTemplateColumns = `repeat(${best.cols}, ${size}px)`;
  listEl.style.gridAutoRows = `${size}px`;
  listEl.style.justifyContent = "center";
  listEl.style.alignContent = "center";

  // Scale font based on box size — cap at a reasonable max
  const fontPx = Math.max(0.8, Math.min(3, size / 24));
  const padPx = Math.max(6, Math.min(24, size / 10));
  const tagFont = Math.max(0.7, Math.min(1.5, size / 36));

  boxes.forEach((box) => {
    box.style.padding = `${padPx}px`;
    box.style.fontSize = `${fontPx}rem`;
    const innerW = size - padPx * 2;

    const tag = box.querySelector(".tv-tag");

    const name = box.querySelector(".tv-box-name");
    if (name) {
      // Name is white-space: nowrap, so only width matters.
      // Height is always one line = font-size * line-height.
      shrinkToFit(name, fontPx, innerW);
    }
    if (tag) {
      shrinkToFit(tag, tagFont, innerW);
    }
    const countEl = box.querySelector(".tv-count");
    if (countEl) {
      shrinkToFit(countEl, Math.max(0.6, tagFont * 0.7), innerW);
    }
  });
}

// Shrink font size until text fits within maxW.
// Temporarily sets display:inline-block to get accurate scrollWidth
// (flex elements report container width, not text width).
function shrinkToFit(el, maxFont, maxW) {
  const origDisplay = el.style.display;
  const origFlex = el.style.flex;
  el.style.display = "inline-block";
  el.style.flex = "none";

  let fs = maxFont;
  el.style.fontSize = `${fs}rem`;
  while (fs > 0.5 && el.scrollWidth > maxW) {
    fs -= 0.05;
    el.style.fontSize = `${fs}rem`;
  }

  el.style.display = origDisplay;
  el.style.flex = origFlex;
}
