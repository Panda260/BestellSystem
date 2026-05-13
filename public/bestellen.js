const socket = io();
const menuContainer = document.getElementById("menu");
const totalEl = document.getElementById("total");
const orderForm = document.getElementById("order-form");
const orderResult = document.getElementById("order-result");
const staffOrders = document.getElementById("staff-orders");

let menu = [];
let lastOrderData = null;

socket.emit("join", { role: "staff" });

socket.on("orders:update", (orders) => {
  renderStaffOrders(orders);
});

async function loadMenu() {
  const response = await fetch("/api/menu");
  menu = await response.json();
  
  const limitsResponse = await fetch("/api/limits");
  const { items: itemLimits, categories: categoryLimits } = await limitsResponse.json();

  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const isInLimitWindow = (h === 12 && m >= 30) || (h === 13 && m <= 45);

  menuContainer.innerHTML = menu
    .map(
      (item, index) => {
        const limitInfo = itemLimits.find(l => l.name === item.name);
        let remaining = null;
        if (limitInfo && limitInfo.max_limit && isInLimitWindow) {
            const current = limitInfo.category ? (categoryLimits[limitInfo.category] || 0) : limitInfo.current_usage;
            remaining = Math.max(0, limitInfo.max_limit - current);
        }

        return `
          <div class="menu-item" onclick="toggleItem(${index})">
            <input type="checkbox" id="item-${index}" data-index="${index}" onclick="event.stopPropagation(); updateTotal()" />
            <label for="item-${index}">
                ${item.name} (${item.price.toFixed(2)} €)
                ${remaining !== null ? `<br><small class="limit-badge">Noch ${remaining} frei</small>` : ''}
            </label>
            <input type="number" id="qty-${index}" data-index="${index}" value="1" min="1" onclick="event.stopPropagation()" oninput="updateTotal()" />
          </div>
        `;
      }
    )
    .join("");
}


window.toggleItem = (index) => {
  const checkbox = document.getElementById(`item-${index}`);
  checkbox.checked = !checkbox.checked;
  updateTotal();
};


function updateTotal() {
  const selections = getSelectedItems();
  const total = selections.reduce((sum, item) => sum + item.price * item.qty, 0);
  totalEl.textContent = `${total.toFixed(2)} €`;
}

function getSelectedItems() {
  return menu
    .map((item, index) => {
      const checkbox = document.getElementById(`item-${index}`);
      const qtyInput = document.getElementById(`qty-${index}`);
      return {
        name: item.name,
        price: item.price,
        qty: Number(qtyInput.value),
        selected: checkbox.checked
      };
    })
    .filter((item) => item.selected && item.qty > 0);
}

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const items = getSelectedItems();
  if (items.length === 0) {
    orderResult.textContent = "Bitte wähle mindestens einen Artikel.";
    return;
  }

  const customerName = document.getElementById("customer-name").value;

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, customerName })
  });


  if (!response.ok) {
    orderResult.textContent = "Fehler beim Anlegen der Bestellung.";
    return;
  }

  const data = await response.json();
  lastOrderData = data;
  orderResult.innerHTML = `
    <p><strong>Bestellung aufgenommen!</strong></p>
    <p>Bestell-ID: <span class="badge">${data.id}</span></p>
    <button class="show-qr-btn" onclick="showQRModal()">QR-Code anzeigen</button>
  `;
  orderForm.reset();
  updateTotal();
  showQRModal();
});

function showQRModal() {
  if (!lastOrderData) return;
  
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  modal.innerHTML = `
    <div class="qr-modal-content">
      <button class="qr-modal-close" onclick="closeQRModal()">&times;</button>
      <h2>QR-Code für Kunden</h2>
      <p>Bestell-ID: <span class="badge">${lastOrderData.id}</span></p>
      <img src="${lastOrderData.qrCodeDataUrl}" alt="QR-Code" />
      <p class="hint">Kunden können diesen QR-Code scannen, um den Bestellstatus zu verfolgen.</p>
    </div>
  `;
  modal.onclick = (e) => {
    if (e.target === modal) closeQRModal();
  };
  document.body.appendChild(modal);
}

function closeQRModal() {
  const modal = document.querySelector('.qr-modal');
  if (modal) modal.remove();
}

// Global für onclick-Handler
window.showQRModal = showQRModal;
window.closeQRModal = closeQRModal;
window.showSpecificQR = async (orderId) => {
  const response = await fetch(`/api/orders/${orderId}`);
  const order = await response.json();
  const orderUrl = `${window.location.protocol}//${window.location.host}/${order.id}`;
  // We can't easily generate QR on client without a lib, but the server has one.
  // Actually, we can just use an API or the same logic as before if we store the URL.
  // Let's just create a temporary hidden img to get the data URL or better, just show the modal with a placeholder and fetch it.
  
  // Actually, the server doesn't have a GET /api/orders/:id/qr endpoint yet. 
  // I'll add one or just generate it here if I had a lib. 
  // Wait, I can just use a public QR API or add an endpoint to server.js.
  // I'll add an endpoint to server.js: GET /api/orders/:id/qr
  
  const qrResponse = await fetch(`/api/orders/${orderId}/qr`);
  const { qrCodeDataUrl } = await qrResponse.json();
  lastOrderData = { id: orderId, qrCodeDataUrl };
  showQRModal();
};


function renderStaffOrders(orders) {
  if (!orders.length) {
    staffOrders.innerHTML = "<p class=\"hint\">Keine offenen Bestellungen.</p>";
    return;
  }

  staffOrders.innerHTML = orders
    .map(
      (order) => `
      <div class="order-card">
        <div class="order-card-header">
          <h3>Bestellung #${order.id} ${order.customerName ? `(${order.customerName})` : ""}</h3>
          <button class="qr-small-btn" onclick="showSpecificQR('${order.id}')">QR</button>
        </div>
        <ul class="status-list">

          ${order.items
            .map(
              (item, index) => `
              <li>
                <span class="${item.done ? "item-done" : ""}">${item.name} × ${item.qty}</span>
                <button data-order="${order.id}" data-index="${index}">
                  ${item.done ? "Rückgängig" : "Fertig"}
                </button>
              </li>
            `
            )
            .join("")}
        </ul>
      </div>
    `
    )
    .join("");

  staffOrders.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderId = button.dataset.order;
      const index = button.dataset.index;
      await fetch(`/api/orders/${orderId}/items/${index}/toggle`, { method: "POST" });
    });
  });
}

loadMenu();
updateTotal();
