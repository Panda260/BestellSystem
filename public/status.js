const socket = io();
const orderId = document.getElementById("order-id").textContent.trim();
const statusEl = document.getElementById("status");

socket.emit("join", { role: "order", orderId });

function renderStatus(order) {
  if (!order) {
    statusEl.innerHTML = "<p class=\"hint\">Keine Bestellung gefunden.</p>";
    return;
  }

  const allDone = order.completed;
  statusEl.innerHTML = `
    <h2>${allDone ? "Deine Bestellung ist fertig!" : "Bestellung in Bearbeitung"}</h2>
    <p>Gesamt: <strong>${order.total.toFixed(2)} €</strong></p>
    <ul class="status-list">
      ${order.items
        .map(
          (item) => `
          <li>
            <span class="${item.done ? "item-done" : ""}">${item.name} × ${item.qty}</span>
            <span>${item.done ? "✔" : "⏳"}</span>
          </li>
        `
        )
        .join("")}
    </ul>
    ${allDone ? '<p class="order-done">Bitte komm zur Ausgabe.</p>' : ""}
  `;
}

socket.on("order:update", (order) => {
  renderStatus(order);
});

fetch(`/api/orders/${orderId}`)
  .then((response) => response.json())
  .then((order) => {
    if (order.message) {
      renderStatus(null);
      return;
    }
    renderStatus(order);
  });
