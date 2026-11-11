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
  // Lunch break & capacity
  pauseStart: "12:30",
  pauseEnd: "13:30",
  ovenSlots: "4",
  fryerSlots: "2",
  changeMinutes: "1",
};

let tvColors = { ...TV_DEFAULTS };

async function loadTvColors() {
  try {
    const res = await fetch("/api/tv-settings");
    if (!res.ok) return;
    const settings = await res.json();
    tvColors = { ...TV_DEFAULTS, ...settings };
    applyTvColors();
    renderTV(lastOrders);
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

// Longest cooking time per station from the menu — used (conservatively)
// for the "noch möglich" capacity of future orders.
let capacityMinutes = { oven: 10, fryer: 6 };
async function loadMenuTimes() {
  try {
    const res = await fetch("/api/menu");
    if (!res.ok) return;
    const menu = await res.json();
    ["oven", "fryer"].forEach((st) => {
      const times = menu.filter((m) => m.station === st && m.cook_minutes).map((m) => m.cook_minutes);
      if (times.length) capacityMinutes[st] = Math.max(...times);
    });
    renderTV(lastOrders);
  } catch (_) {}
}

// Listen for settings updates via socket
socket.on("tv-settings:update", () => {
  loadTvColors();
});

loadTvColors();
loadMenuTimes();

// Server clock offset, so countdowns match the kitchen even if the TV's clock is off
let clockOffset = 0;
socket.on("server:time", (serverNow) => {
  clockOffset = serverNow - Date.now();
});
const nowMs = () => Date.now() + clockOffset;

let lastOrders = [];
socket.on("orders:update", (orders) => {
  lastOrders = orders;
  loadMenuTimes(); // menu cook times may have changed
  renderTV(orders);
});

window.addEventListener("resize", () => {
  fitBoxes();
});

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

// mm:ss, or +mm:ss once overdue
function fmtCountdown(ms) {
  const overdue = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return overdue ? `+${text}` : text;
}

// German clock (always Europe/Berlin) + time left in the lunch break
const clockEl = document.getElementById("tv-clock");
const planEl = document.getElementById("tv-plan");
let lastPlan = null;

function updateClock() {
  const now = nowMs();
  let pauseText = "";
  let pauseCls = "";
  if (lastPlan) {
    const { pauseStartMs, pauseEndMs } = lastPlan;
    if (now < pauseStartMs) {
      pauseText = `Pause ab ${fmtTime(pauseStartMs)}`;
    } else if (now < pauseEndMs) {
      const left = pauseEndMs - now;
      pauseText = `Pause noch ${Math.ceil(left / 60000)} min`;
      if (left <= 10 * 60000) pauseCls = "warn";
    } else {
      pauseText = "Pause vorbei";
      pauseCls = "over";
    }
  }
  clockEl.innerHTML = `${fmtTime(now)}${pauseText ? `<span class="tv-pause ${pauseCls}">${pauseText}</span>` : ""}`;
}

// Per-second tick: only update countdown texts, no full re-render
function tick() {
  updateClock();
  const now = nowMs();
  const globalEl = planEl && planEl.querySelector("[data-ready]");
  if (globalEl) {
    const left = Number(globalEl.dataset.ready) - now;
    globalEl.textContent = left > 0 ? fmtCountdown(left) : "gleich";
  }
  listEl.querySelectorAll("[data-ends]").forEach((el) => {
    const left = Number(el.dataset.ends) - now;
    el.querySelector(".tv-chip-time").textContent = fmtCountdown(left);
    el.classList.toggle("overdue", left < 0);
  });
}
setInterval(tick, 1000);
// ETAs and capacity shift over time — recompute every 15 s
setInterval(() => renderTV(lastOrders), 15000);

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Emoji per item, matched by name (case-insensitive), falling back to the station
const ITEM_EMOJIS = [
  { match: "pizza", emoji: "🍕" },
  { match: "brezel", emoji: "🥨" },
];
const STATION_EMOJIS = { oven: "🍕", fryer: "🥨" };

function itemEmoji(item) {
  const n = String(item.name || "").toLowerCase();
  const hit = ITEM_EMOJIS.find((e) => n.includes(e.match));
  return hit ? hit.emoji : (STATION_EMOJIS[item.station] || "");
}

// Chips per order: cooking items one by one (with countdown),
// waiting / done items grouped by emoji ("🍕×2").
function renderChips(order, plan) {
  const cooking = [];
  const groups = new Map(); // "waiting|🍕" -> count
  order.items.forEach((item, index) => {
    if (item.pickedUp) return;
    const emoji = itemEmoji(item);
    if (!emoji) return;
    const info = plan.items.get(itemKey(order.id, index));
    if (!item.done && item.inOven) {
      if (info?.state === "cooking" && info.hasStart) {
        cooking.push({ emoji, endsAt: info.endsAt });
      } else {
        cooking.push({ emoji, endsAt: null });
      }
      return;
    }
    const state = item.done ? "done" : "waiting";
    const key = `${state}|${emoji}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  });

  const now = nowMs();
  const chips = cooking
    .sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0))
    .map((c) => {
      if (!c.endsAt) return `<span class="tv-chip cooking">${c.emoji}</span>`;
      const left = c.endsAt - now;
      return `<span class="tv-chip cooking ${left < 0 ? "overdue" : ""}" data-ends="${c.endsAt}">${c.emoji}<span class="tv-chip-time">${fmtCountdown(left)}</span></span>`;
    });
  // waiting first, then done
  ["waiting", "done"].forEach((state) => {
    groups.forEach((count, key) => {
      const [s, emoji] = key.split("|");
      if (s !== state) return;
      const n = count > 1 ? `<span class="tv-chip-count">×${count}</span>` : "";
      const check = state === "done" ? '<span class="tv-chip-check">✓</span>' : "";
      chips.push(`<span class="tv-chip ${state}">${emoji}${n}${check}</span>`);
    });
  });
  return chips.length ? `<div class="tv-chips">${chips.join("")}</div>` : "";
}

// Global estimate: when will the very last open order be ready?
function lastReadyMs(plan) {
  let max = 0;
  plan.orderEta.forEach((t) => { if (t > max) max = t; });
  return max;
}

function readyText(plan, now) {
  const end = lastReadyMs(plan);
  const left = end - now;
  return { end, left, text: left > 0 ? fmtCountdown(left) : "gleich" };
}

function renderPlanBar(plan) {
  if (!planEl) return;
  const now = nowMs();
  const pauseOver = now >= plan.pauseEndMs;
  const end = lastReadyMs(plan);
  if (pauseOver && !end) {
    planEl.innerHTML = "";
    planEl.style.display = "none";
    return;
  }
  planEl.style.display = "";
  const cap = (emoji, n) => `<span class="tv-cap ${n === 0 ? "none" : ""}">${emoji} ${n}</span>`;
  let html = "";
  if (end) {
    const r = readyText(plan, now);
    const late = end > plan.pauseEndMs;
    html += `<span class="tv-cap-label">Alles fertig ca. ${fmtTime(end)}</span><span class="tv-global-eta ${late ? "late" : ""}" data-ready="${end}">${r.text}</span>`;
  }
  if (!pauseOver) {
    html += `<span class="tv-cap-label">Noch möglich bis ${fmtTime(plan.pauseEndMs)}:</span>${cap("🍕", plan.capacity.oven)}${cap("🥨", plan.capacity.fryer)}`;
  }
  planEl.innerHTML = html;
}

function renderTV(orders) {
  const active = orders.filter((o) => !o.pickedUp);

  const plan = planKitchen(active, nowMs(), {
    ovenSlots: tvColors.ovenSlots,
    fryerSlots: tvColors.fryerSlots,
    changeMinutes: tvColors.changeMinutes,
    pauseStart: tvColors.pauseStart,
    pauseEnd: tvColors.pauseEnd,
    ovenCapacityMinutes: capacityMinutes.oven,
    fryerCapacityMinutes: capacityMinutes.fryer,
  });
  lastPlan = plan;
  renderPlanBar(plan);
  updateClock();

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
    const chips = renderChips(o, plan);
    // Chips already show per-item status — the "1/3" counter is only needed without them
    const showCount = total > 1 && !chips;

    // Estimated ready time while something is still waiting for oven/fryer
    let eta = "";
    const hasWaiting = o.items.some((i, idx) => plan.items.get(itemKey(o.id, idx))?.state === "waiting");
    const etaMs = plan.orderEta.get(o.id);
    if (hasWaiting && etaMs) {
      const late = etaMs > plan.pauseEndMs;
      eta = `<span class="tv-eta ${late ? "late" : ""}">fertig ca. ${fmtTime(etaMs)}</span>`;
    }

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
        ${chips}
        ${eta}
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
  // Emoji chips get about as big as the name, so they're readable from afar
  const chipFont = Math.max(1.6, Math.min(5.2, size / 13));

  boxes.forEach((box) => {
    box.style.padding = `${padPx}px`;
    box.style.fontSize = `${fontPx}rem`;
    const innerW = size - padPx * 2;

    const tag = box.querySelector(".tv-tag");

    const chipsEl = box.querySelector(".tv-chips");
    const name = box.querySelector(".tv-box-name");
    if (name) {
      // Name is white-space: nowrap, so only width matters.
      // Height is always one line = font-size * line-height.
      // With chips the name gets a bit smaller to leave room for them.
      shrinkToFit(name, chipsEl ? fontPx * 0.75 : fontPx, innerW);
    }
    if (chipsEl) {
      // Chips wrap; limit them to roughly half of the box height
      shrinkToHeight(chipsEl, chipFont, size * 0.6);
    }
    const etaEl = box.querySelector(".tv-eta");
    if (etaEl) {
      shrinkToFit(etaEl, tagFont, innerW);
    }
    if (tag) {
      shrinkToFit(tag, tagFont, innerW);
    }
    const countEl = box.querySelector(".tv-count");
    if (countEl) {
      shrinkToFit(countEl, Math.max(0.6, tagFont * 0.7), innerW);
    }
    // If the box still overflows (many chips + ETA + tag), shrink the chips further
    if (chipsEl) {
      let fs = parseFloat(chipsEl.style.fontSize);
      while (fs > 0.5 && box.scrollHeight > box.clientHeight) {
        fs -= 0.05;
        chipsEl.style.fontSize = `${fs}rem`;
      }
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

// Shrink font size until a wrapping element fits within maxH.
function shrinkToHeight(el, maxFont, maxH) {
  let fs = maxFont;
  el.style.fontSize = `${fs}rem`;
  while (fs > 0.5 && el.scrollHeight > maxH) {
    fs -= 0.05;
    el.style.fontSize = `${fs}rem`;
  }
}
