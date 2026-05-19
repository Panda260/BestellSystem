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
            <span class="tv-oven-status ${o.inOven ? 'in-oven' : 'not-in-oven'}">
                ${o.inOven ? 'Im Ofen' : 'Nicht im Ofen'}
            </span>
        </div>
    `).join("");

    readyEl.innerHTML = ready.map(o => {
        const name = o.customerName || `#${o.id}`;
        let fontSize = '1.8rem';
        if (name.length > 25) {
            fontSize = '1.1rem';
        } else if (name.length > 18) {
            fontSize = '1.3rem';
        } else if (name.length > 12) {
            fontSize = '1.5rem';
        }
        return `
            <div class="tv-item ready" style="font-size: ${fontSize};">
                <span class="tv-name">${name}</span>
                <span class="tv-pickup">Bestellung Abholen</span>
            </div>
        `;
    }).join("");
}
