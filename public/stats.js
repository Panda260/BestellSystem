async function loadStats() {
    const response = await fetch("/api/stats");
    const { today, total } = await response.json();
    
    renderStats("stats-today", today);
    renderStats("stats-total", total);
}

function renderStats(elementId, stats) {
    const el = document.getElementById(elementId);
    const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    
    if (sorted.length === 0) {
        el.innerHTML = "<p class='hint'>Noch keine Bestellungen.</p>";
        return;
    }
    
    el.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Anzahl</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(([name, qty]) => `
                    <tr>
                        <td>${name}</td>
                        <td>${qty}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

loadStats();
