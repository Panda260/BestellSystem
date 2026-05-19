async function loadLifetimeStats() {
    const response = await fetch("/api/stats");
    const { lifetime } = await response.json();
    
    renderStats("stats-lifetime", lifetime || {});
}

function renderStats(elementId, stats) {
    const el = document.getElementById(elementId);
    const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    
    if (sorted.length === 0) {
        el.innerHTML = "<p class='hint'>Noch keine Bestellungen verzeichnet.</p>";
        return;
    }
    
    el.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Lifetime Anzahl</th>
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

loadLifetimeStats();
