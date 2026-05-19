const socket = io();
const kitchenOrders = document.getElementById("kitchen-orders");

socket.emit("join", { role: "kitchen" });

socket.on("orders:update", (orders) => {
  if (!orders.length) {
    kitchenOrders.innerHTML = "<p class=\"hint\">Keine offenen Bestellungen.</p>";
    return;
  }

  kitchenOrders.innerHTML = orders
    .map(
      (order) => `
      <div class="order-card">
        <h3>
          Bestellung #${order.id} ${order.customerName ? `(${order.customerName})` : ""}
          <span class="oven-status ${order.inOven ? 'in-oven' : 'not-in-oven'}">
            ${order.inOven ? 'Im Ofen' : 'Nicht im Ofen'}
          </span>
        </h3>

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
      </div>
    `
    )
    .join("");
});
