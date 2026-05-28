async function loadHistory() {
    const historyOrders = document.getElementById("history-orders");
    try {
        const response = await fetch("/api/orders/history/today");
        if (!response.ok) {
            throw new Error("Fehler beim Laden des Verlaufs");
        }
        const orders = await response.json();
        
        if (!orders.length) {
            historyOrders.innerHTML = "<p class=\"hint\">Noch keine abgeholten Bestellungen heute.</p>";
            return;
        }

        historyOrders.innerHTML = orders.map(order => `
            <div class="order-card history-card">
                <div class="order-card-header">
                    <h3>Bestellung #${order.id} ${order.customerName ? `(${order.customerName})` : ""}</h3>
                    <button class="reopen-btn" onclick="reopenOrder('${order.id}')">Wieder öffnen</button>
                </div>
                <p>Abgeholt um: ${new Date(order.pickedUpAt).toLocaleTimeString()}</p>
                <ul class="status-list">
                ${order.items.map(item => `
                    <li>
                        <span class="item-done">${item.name} × ${item.qty}</span>
                    </li>
                `).join("")}
                </ul>
            </div>
        `).join("");
    } catch (err) {
        historyOrders.innerHTML = `<p class="error">${err.message}</p>`;
    }
}

window.reopenOrder = async (orderId) => {
    try {
        await fetch(`/api/orders/${orderId}/reopen`, { method: "POST" });
        loadHistory(); // Reload the history view
    } catch (err) {
        alert("Fehler beim Wiedereröffnen der Bestellung: " + err.message);
    }
};

window.clearHistory = async () => {
    if (confirm("Bist du sicher, dass du den kompletten Verlauf leeren möchtest? (Die Tages-Statistiken bleiben dabei erhalten!)")) {
        try {
            const response = await fetch("/api/orders/history", { method: "DELETE" });
            if (!response.ok) throw new Error("Server Error");
            loadHistory();
        } catch (err) {
            alert("Fehler beim Löschen des Verlaufs: " + err.message);
        }
    }
};

loadHistory();
