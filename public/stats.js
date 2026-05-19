async function loadStats() {
    const response = await fetch("/api/stats");
    const { today, total, lifetime } = await response.json();
    
    renderStats("stats-today", today);
    renderStats("stats-total", total);
    renderStats("stats-lifetime", lifetime || {});
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

document.getElementById("reset-stats-btn").addEventListener("click", async () => {
    if (!confirm("Bist du sicher? Alle Bestellungen und Statistiken werden unwiderruflich gelöscht!")) return;
    
    const response = await fetch("/api/stats", { method: "DELETE" });
    if (response.ok) {
        loadStats();
    }
});

const toggleLifetimeBtn = document.getElementById("toggle-lifetime-btn");
const lifetimeCard = document.getElementById("lifetime-card");

if (toggleLifetimeBtn && lifetimeCard) {
    toggleLifetimeBtn.addEventListener("click", () => {
        if (lifetimeCard.style.display === "none" || !lifetimeCard.style.display) {
            lifetimeCard.style.display = "block";
            toggleLifetimeBtn.textContent = "Lifetime-Statistik ausblenden";
            toggleLifetimeBtn.classList.remove("secondary");
            toggleLifetimeBtn.classList.add("success");
        } else {
            lifetimeCard.style.display = "none";
            toggleLifetimeBtn.textContent = "Lifetime-Statistik anzeigen";
            toggleLifetimeBtn.classList.remove("success");
            toggleLifetimeBtn.classList.add("secondary");
        }
    });
}

loadStats();

