async function loadStats() {
    const response = await fetch("/api/stats");
    const { today, total, todayCustomers, totalCustomers } = await response.json();

    renderStats("stats-today", today);
    renderStats("stats-total", total);
    renderCustomerStats("customer-stats-today", todayCustomers);
    renderCustomerStats("customer-stats-total", totalCustomers);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
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
                        <td>${escapeHtml(name)}</td>
                        <td>${qty}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderCustomerStats(elementId, stats) {
    const el = document.getElementById(elementId);
    const sorted = Object.entries(stats).sort((a, b) => b[1].qty - a[1].qty);

    if (sorted.length === 0) {
        el.innerHTML = "<p class='hint'>Noch keine Bestellungen.</p>";
        return;
    }

    el.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Artikel</th>
                    <th>Umsatz</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(([name, data]) => `
                    <tr>
                        <td>${escapeHtml(name)}</td>
                        <td>${data.qty}</td>
                        <td>${data.total.toFixed(2).replace(".", ",")} €</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

document.getElementById("reset-stats-btn").addEventListener("click", async () => {
    if (!confirm("Bist du sicher? Alle Bestellungen und Statistiken werden unwiderruflich gelöscht!")) return;
    
    const response = await fetch("/api/stats", { method: "DELETE" });
    if (response.ok) {
        loadStats();
    }
});

document.getElementById("backfill-names-btn").addEventListener("click", async () => {
    const btn = document.getElementById("backfill-names-btn");
    const resultEl = document.getElementById("backfill-result");
    btn.disabled = true;
    btn.textContent = "Backfill läuft...";
    resultEl.textContent = "";
    try {
        const res = await fetch("/api/names/backfill", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Backfill fehlgeschlagen");
        resultEl.textContent = `Fertig: ${data.added} neu hinzugefügt, ${data.skipped} Duplikate übersprungen (${data.total} Namen gesamt).`;
    } catch (err) {
        resultEl.textContent = "Fehler: " + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = "Namen in Autocomplete übernehmen";
    }
});

loadStats();

