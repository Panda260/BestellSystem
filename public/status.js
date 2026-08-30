const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
const orderId = document.getElementById("order-id").textContent.trim();
const statusEl = document.getElementById("status");

socket.emit("join", { role: "order", orderId });

socket.on("connect", () => {
  socket.emit("join", { role: "order", orderId });
});

let lastCompletedStatus = null;

function playNotificationSound() {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime); // A5
  oscillator.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.5); // A4
  
  gain.gain.setValueAtTime(0.1, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
  
  oscillator.connect(gain);
  gain.connect(context.destination);
  
  oscillator.start();
  oscillator.stop(context.currentTime + 0.5);
}


function renderStatus(order) {
  if (!order) {
    statusEl.innerHTML = "<p class=\"hint\">Keine Bestellung gefunden.</p>";
    return;
  }

  const allDone = order.completed;
  const anyInOven = order.items.some((i) => i.inOven) && !allDone;
  const ovenStatusHtml = allDone
    ? ''
    : `<div class="status-banner ${anyInOven ? 'in-oven' : 'not-in-oven'}">
        Status: ${anyInOven ? 'Im Ofen' : 'Nicht im Ofen'}
       </div>`;

  statusEl.innerHTML = `
    <h2>${allDone ? "Deine Bestellung ist fertig!" : "Bestellung in Bearbeitung"}</h2>
    ${ovenStatusHtml}
    <p>Gesamt: <strong>${order.total.toFixed(2)} €</strong></p>
    <ul class="status-list">
      ${order.items
        .map(
          (item) => `
          <li>
            <span class="${item.done ? "item-done" : ""}">${item.name} × ${item.qty}${item.inOven ? ' 🔥' : ''}</span>
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
  if (order.completed && lastCompletedStatus === false) {
    playNotificationSound();
  }
  lastCompletedStatus = order.completed;
  renderStatus(order);
});


fetch(`/api/orders/${orderId}`)
  .then((response) => response.json())
  .then((order) => {
    if (order.message) {
      renderStatus(null);
      return;
    }
    lastCompletedStatus = order.completed;
    renderStatus(order);
  });

