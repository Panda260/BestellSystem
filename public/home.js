const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
const staffOrders = document.getElementById("staff-orders");

let allOrders = [];
let searchQuery = "";

socket.emit("join", { role: "staff" });

socket.on("connect", () => {
  socket.emit("join", { role: "staff" });
});

socket.on("orders:update", (orders) => {
  allOrders = orders;
  renderOrders(orders);
});

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- Search ----
const searchBtn = document.getElementById("search-btn");
const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("order-search");
const searchClose = document.getElementById("search-close");

searchBtn.addEventListener("click", () => {
  searchBar.classList.toggle("hidden");
  if (!searchBar.classList.contains("hidden")) {
    searchInput.focus();
  }
});

searchClose.addEventListener("click", () => {
  searchBar.classList.add("hidden");
  searchInput.value = "";
  searchQuery = "";
  renderOrders(allOrders);
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  renderOrders(allOrders);
});

function matchesSearch(order) {
  if (!searchQuery) return true;
  const name = (order.customerName || "").toLowerCase();
  const id = String(order.id);
  return name.includes(searchQuery) || id.includes(searchQuery);
}

function renderOrders(orders) {
  const filtered = orders.filter(matchesSearch);
  const sorted = [...filtered].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
  if (!sorted.length) {
    staffOrders.innerHTML = searchQuery
      ? '<div class="empty-state">Keine Treffer für Suche.</div>'
      : '<div class="empty-state">Keine offenen Bestellungen.</div>';
    return;
  }

  staffOrders.innerHTML = sorted
    .map((order) => {
      const allDone = order.items.length > 0 && order.items.every((i) => i.done);
      const cardClass = allDone ? "order-card ready" : "order-card";

      const itemsHtml = order.items
        .map((item, index) => {
          if (item.pickedUp) return "";
          const ovenBtn = item.done ? "" : `<button class="oven-toggle small ${item.inOven ? "in-oven" : "not-in-oven"}" onclick="toggleItemOven('${order.id}', ${index})">${item.inOven ? "🔥 Im Ofen" : "Nicht im Ofen"}</button>`;
          return `
          <li>
            <span class="item-label ${item.done ? "item-done" : ""}">${escapeHtml(item.name)}</span>
            <div class="item-actions">
              ${ovenBtn}
              ${item.done
                ? `<button class="pickup-btn-small" onclick="pickupItem('${order.id}', ${index})">Abgeholt</button>`
                : `<button class="button success small done-btn" data-order="${order.id}" data-index="${index}">Fertig</button>`
              }
            </div>
          </li>`;
        })
        .join("");

      return `
      <div class="${cardClass}">
        <div class="order-card-header">
          <div class="order-id-row">
            <span class="order-number">#${order.id}</span>
            ${order.customerName ? `<span class="order-name">${escapeHtml(order.customerName)}</span>` : ""}
          </div>
          <button class="qr-small-btn" onclick="showQR('${order.id}')" aria-label="QR-Code">QR</button>
        </div>

        <ul class="status-list">${itemsHtml}</ul>
      </div>
    `;
    })
    .join("");

  staffOrders.querySelectorAll(".done-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/orders/${btn.dataset.order}/items/${btn.dataset.index}/toggle`, {
        method: "POST",
      });
    });
  });
}

window.toggleItemOven = async (orderId, index) => {
  await fetch(`/api/orders/${orderId}/items/${index}/toggle-oven`, { method: "POST" });
};

window.toggleOven = async (orderId) => {
  await fetch(`/api/orders/${orderId}/toggle-oven`, { method: "POST" });
};

window.showQR = async (orderId) => {
  const res = await fetch(`/api/orders/${orderId}/qr`);
  if (!res.ok) return;
  const { qrCodeDataUrl } = await res.json();
  const modal = document.createElement("div");
  modal.className = "qr-modal";
  modal.innerHTML = `
    <div class="qr-modal-content">
      <button class="qr-modal-close" onclick="this.closest('.qr-modal').remove()">&times;</button>
      <h2>Bestellung #${orderId}</h2>
      <img src="${qrCodeDataUrl}" alt="QR-Code" />
      <p class="hint">QR-Code scannen für Status</p>
    </div>`;
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  document.body.appendChild(modal);
};

window.pickupItem = async (orderId, index) => {
  try {
    await fetch(`/api/orders/${orderId}/items/${index}/pickup`, { method: "POST" });
  } catch (e) { console.error("Pickup failed:", e); }
};
