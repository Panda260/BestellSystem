async function loadAdminMenu() {
    const response = await fetch("/api/admin/menu");
    const menu = await response.json();
    const list = document.getElementById("admin-menu-list");
    
    list.innerHTML = menu.map(item => `
        <div class="card admin-item ${item.active ? '' : 'inactive'}">
            <div class="admin-item-info">
                <div><small>Name:</small><input type="text" value="${item.name}" placeholder="Name" onchange="updateItem(${item.id}, 'name', this.value)" /></div>
                <div><small>Preis:</small><input type="number" step="0.01" value="${item.price.toFixed(2)}" placeholder="Preis" onchange="updateItem(${item.id}, 'price', this.value)" /></div>
                <div><small>Limit:</small><input type="number" value="${item.max_limit || ''}" placeholder="Kein Limit" onchange="updateItem(${item.id}, 'max_limit', this.value)" title="Max Limit (12:30-13:45)" /></div>
                <div><small>Kategorie:</small><input type="text" value="${item.category || ''}" placeholder="Kategorie" onchange="updateItem(${item.id}, 'category', this.value)" title="Kategorie für gemeinsames Limit" /></div>
            </div>

            <div class="admin-item-actions">

                <button class="${item.active ? 'secondary' : 'success'}" onclick="updateItem(${item.id}, 'active', ${!item.active})">
                    ${item.active ? 'Deaktivieren' : 'Aktivieren'}
                </button>
                <button class="danger" onclick="deleteItem(${item.id})">Löschen</button>
            </div>
        </div>
    `).join("");
}

async function updateItem(id, field, value) {
    const response = await fetch("/api/admin/menu");
    const items = await response.json();
    const item = items.find(i => i.id === id);
    if (!item) return;

    const updatedData = {
        name: field === 'name' ? value : item.name,
        price: field === 'price' ? parseFloat(value) : item.price,
        active: field === 'active' ? (value === true || value === 1) : !!item.active,
        max_limit: field === 'max_limit' ? (value ? parseInt(value) : null) : item.max_limit,
        category: field === 'category' ? (value || null) : item.category
    };


    await fetch(`/api/admin/menu/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData)
    });
    loadAdminMenu();
}


async function deleteItem(id) {
    if (!confirm("Sicher löschen?")) return;
    await fetch(`/api/admin/menu/${id}`, { method: "DELETE" });
    loadAdminMenu();
}

document.getElementById("add-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-name").value;
    const price = parseFloat(document.getElementById("new-price").value);
    const max_limit = document.getElementById("new-limit").value ? parseInt(document.getElementById("new-limit").value) : null;
    const category = document.getElementById("new-category").value || null;
    
    await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, max_limit, category })
    });

    
    e.target.reset();
    loadAdminMenu();
});

loadAdminMenu();
