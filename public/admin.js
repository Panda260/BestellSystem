async function loadAdminMenu() {
    const response = await fetch("/api/admin/menu");
    const menu = await response.json();
    const list = document.getElementById("admin-menu-list");
    
    list.innerHTML = menu.map(item => `
        <div class="card admin-item ${item.active ? '' : 'inactive'}">
            <div class="admin-item-info">
                <input type="text" value="${item.name}" onchange="updateItem(${item.id}, 'name', this.value)" />
                <input type="number" step="0.01" value="${item.price.toFixed(2)}" onchange="updateItem(${item.id}, 'price', this.value)" />
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
        active: field === 'active' ? (value === true || value === 1) : !!item.active
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
    
    await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price })
    });
    
    e.target.reset();
    loadAdminMenu();
});

loadAdminMenu();
