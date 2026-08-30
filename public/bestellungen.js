const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
const kitchenOrders = document.getElementById("kitchen-orders");

socket.emit("join", { role: "kitchen" });

socket.on("connect", () => {
  socket.emit("join", { role: "kitchen" });
});

socket.on("orders:update", (orders) => {
  const sortedOrders = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (!sortedOrders.length) {
    kitchenOrders.innerHTML = "<p class=\"hint\">Keine offenen Bestellungen.</p>";
    return;
  }

  kitchenOrders.innerHTML = sortedOrders
    .map(
      (order) => `
      <div class="order-card">
        <h3>
          Bestellung #${order.id} ${order.customerName ? `(${order.customerName})` : ""}
        </h3>

        <ul class="status-list">
          ${order.items
            .map((item) => {
              if (item.pickedUp) return "";
              const ovenIcon = item.inOven ? ' 🔥' : '';
              return `
              <li>
                <span class="${item.done ? "item-done" : ""}">${item.name} × ${item.qty}${ovenIcon}</span>
                <span>${item.done ? "✔" : "⏳"}</span>
              </li>
            `;
            })
            .join("")}
        </ul>
      </div>
    `
    )
    .join("");
});
