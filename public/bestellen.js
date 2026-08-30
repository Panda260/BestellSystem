const socket = io();

let menu = [];
let lastOrderData = null;
let selectedName = "";

// ---- Elements ----
const nameInput = document.getElementById("customer-name");
const allNamesEl = document.getElementById("all-names");
const toItemsBtn = document.getElementById("to-items-btn");

const stepName = document.getElementById("step-name");
const stepItems = document.getElementById("step-items");
const nameDisplay = document.getElementById("name-display");
const changeNameBtn = document.getElementById("change-name-btn");

const menuContainer = document.getElementById("menu");
const totalEl = document.getElementById("total");
const submitOrderBtn = document.getElementById("submit-order-btn");
const orderResult = document.getElementById("order-result");

// ---- All names list ----
let allNames = [];

async function loadAllNames() {
  try {
    const res = await fetch("/api/names");
    if (!res.ok) return;
    allNames = await res.json();
    renderAllNames("");
  } catch (_) {}
}

function renderAllNames(filter) {
  const q = filter.toLowerCase().trim();
  const filtered = q
    ? allNames.filter((n) => n.name.toLowerCase().includes(q))
    : allNames;
  if (!filtered.length) {
    allNamesEl.innerHTML = '<p class="hint">Keine Namen gespeichert.</p>';
    return;
  }
  allNamesEl.innerHTML = filtered
    .map((n) => `<button type="button" class="name-pick" data-name="${escapeAttr(n.name)}">${escapeHtml(n.name)}</button>`)
    .join("");
  allNamesEl.querySelectorAll(".name-pick").forEach((el) => {
    el.addEventListener("click", () => {
      nameInput.value = el.dataset.name;
      selectedName = el.dataset.name;
      toItemsBtn.disabled = false;
      goToItems();
    });
  });
}

loadAllNames();

nameInput.addEventListener("input", () => {
  selectedName = nameInput.value.trim();
  toItemsBtn.disabled = !selectedName;
  orderResult.innerHTML = "";
  renderAllNames(nameInput.value.trim());
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (selectedName) goToItems();
  }
});

// ---- Wizard navigation ----
toItemsBtn.addEventListener("click", goToItems);
changeNameBtn.addEventListener("click", () => {
  stepItems.classList.add("hidden");
  stepName.classList.remove("hidden");
  nameInput.focus();
  nameInput.select();
});

function goToItems() {
  if (!selectedName) return;
  nameDisplay.textContent = selectedName;
  stepName.classList.add("hidden");
  stepItems.classList.remove("hidden");
  if (!menu.length) loadMenu();
}

// ---- Menu ----
const quantities = {}; // index -> qty

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
    .map((item, index) => {
      const limitInfo = itemLimits.find((l) => l.name === item.name);
      let remaining = null;
      if (limitInfo && limitInfo.max_limit && isInLimitWindow) {
        const current = limitInfo.category
          ? categoryLimits[limitInfo.category] || 0
          : limitInfo.current_usage;
        remaining = Math.max(0, limitInfo.max_limit - current);
      }
      quantities[index] = 0;

      return `
        <div class="menu-item" data-index="${index}">
          <div class="item-name" onclick="tapCard(${index})">${escapeHtml(item.name)}</div>
          <div class="item-price">${item.price.toFixed(2).replace(".", ",")} €
            ${remaining !== null ? `<span class="limit-badge">Noch ${remaining} frei</span>` : ""}
          </div>
          <div class="item-qty">
            <button type="button" class="qty-btn" onclick="decQty(${index})" aria-label="weniger">&minus;</button>
            <span class="qty-display zero" id="qty-display-${index}">0</span>
            <button type="button" class="qty-btn" onclick="incQty(${index})" aria-label="mehr">+</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// Tap on card name = +1
window.tapCard = (index) => incQty(index);

window.incQty = (index) => {
  quantities[index] = (quantities[index] || 0) + 1;
  updateQtyDisplay(index);
  updateTotal();
};

window.decQty = (index) => {
  if (quantities[index] > 0) {
    quantities[index]--;
    updateQtyDisplay(index);
    updateTotal();
  }
};

function updateQtyDisplay(index) {
  const disp = document.getElementById(`qty-display-${index}`);
  if (!disp) return;
  disp.textContent = quantities[index];
  disp.classList.toggle("zero", quantities[index] === 0);
  const card = menuContainer.querySelector(`.menu-item[data-index="${index}"]`);
  if (card) card.classList.toggle("selected", quantities[index] > 0);
}

function updateTotal() {
  const selections = getSelectedItems();
  const total = selections.reduce((sum, item) => sum + item.price * item.qty, 0);
  totalEl.textContent = `${total.toFixed(2).replace(".", ",")} €`;
  submitOrderBtn.disabled = selections.length === 0;
}

function getSelectedItems() {
  return menu
    .map((item, index) => ({
      name: item.name,
      price: item.price,
      qty: quantities[index] || 0,
    }))
    .filter((item) => item.qty > 0);
}

// ---- Submit ----
submitOrderBtn.addEventListener("click", async () => {
  const items = getSelectedItems();
  if (items.length === 0) {
    orderResult.textContent = "Bitte wähle mindestens einen Artikel.";
    return;
  }

  submitOrderBtn.disabled = true;
  orderResult.textContent = "Wird gesendet...";

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, customerName: selectedName }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    orderResult.textContent = data.message || "Fehler beim Anlegen der Bestellung.";
    submitOrderBtn.disabled = false;
    return;
  }

  const data = await response.json();
  lastOrderData = data;
  orderResult.innerHTML = `
    <p><strong>Bestellung aufgenommen!</strong></p>
    <p>Bestell-ID: <span class="badge">${data.id}</span></p>
    <button class="show-qr-btn" onclick="showQRModal()">QR-Code anzeigen</button>
    <button class="button secondary small" onclick="resetWizard()">Neue Bestellung</button>
  `;
  showQRModal();
});

window.resetWizard = () => {
  menu.forEach((_, index) => {
    quantities[index] = 0;
    updateQtyDisplay(index);
  });
  updateTotal();
  orderResult.innerHTML = "";
  // back to name step
  stepItems.classList.add("hidden");
  stepName.classList.remove("hidden");
  nameInput.value = "";
  selectedName = "";
  toItemsBtn.disabled = true;
  nameInput.focus();
};

function showQRModal() {
  if (!lastOrderData) return;
  const modal = document.createElement("div");
  modal.className = "qr-modal";
  modal.innerHTML = `
    <div class="qr-modal-content">
      <button class="qr-modal-close" onclick="closeQRModal()">&times;</button>
      <h2>QR-Code für Kunden</h2>
      <p>Bestell-ID: <span class="badge">${lastOrderData.id}</span></p>
      <img src="${lastOrderData.qrCodeDataUrl}" alt="QR-Code" />
      <p class="hint">Kunden scannen, um den Status zu verfolgen.</p>
    </div>
  `;
  modal.onclick = (e) => {
    if (e.target === modal) closeQRModal();
  };
  document.body.appendChild(modal);
}

window.showQRModal = showQRModal;
window.closeQRModal = () => {
  const modal = document.querySelector(".qr-modal");
  if (modal) modal.remove();
  // Nach QR-Schließen zurück zur Startseite mit Bestellliste
  window.location.href = "/";
};

// ---- Helpers ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
