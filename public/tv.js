const socket = io();

const pendingEl = document.getElementById("tv-pending");
const readyEl = document.getElementById("tv-ready");

socket.emit("join", { role: "tv" });

socket.on("orders:update", (orders) => {
    renderTV(orders);
});

function renderTV(orders) {
    const pending = orders.filter(o => !o.completed).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const ready = orders.filter(o => o.completed).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 10);
    
    pendingEl.innerHTML = pending.map(o => `
        <div class="tv-item pending">
            <span class="tv-id">#${o.id}</span>
            <span class="tv-name">${o.customerName || ''}</span>
        </div>
    `).join("");

    readyEl.innerHTML = ready.map(o => `
        <div class="tv-item ready">
            <span class="tv-id">#${o.id}</span>
            <span class="tv-name">${o.customerName || ''}</span>
        </div>
    `).join("");
}
