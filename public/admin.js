let categories = [];

async function loadAdminData() {
    const [menuRes, catRes] = await Promise.all([
        fetch("/api/admin/menu"),
        fetch("/api/admin/categories")
    ]);
    
    const menu = await menuRes.json();
    categories = await catRes.json();
    
    renderCategories();
    renderMenu(menu);
    populateAddProductCategories();
}

function populateAddProductCategories() {
    const select = document.getElementById("new-category");
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Keine</option>' + 
        categories.map(cat => `<option value="${cat.name}">${cat.name}</option>`).join("");
    select.value = currentVal;
}


function renderCategories() {
    const list = document.getElementById("admin-category-list");
    list.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Kategorie</th>
                    <th>Max Limit</th>
                    <th>Aktionen</th>
                </tr>
            </thead>
            <tbody>
                ${categories.map(cat => `
                    <tr>
                        <td>${cat.name}</td>
                        <td>
                            <input type="number" value="${cat.max_limit || ''}" 
                                onchange="updateCategory('${cat.name}', this.value)" 
                                placeholder="Kein Limit" style="width: 80px" />
                        </td>
                        <td>
                            <button class="danger" onclick="deleteCategory('${cat.name}')">Löschen</button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderMenu(menu) {
    const list = document.getElementById("admin-menu-list");
    list.innerHTML = menu.map(item => `
        <div class="card admin-item ${item.active ? '' : 'inactive'}">
            <div class="admin-item-info">
                <div><small>Name:</small><input type="text" value="${item.name}" onchange="updateItem(${item.id}, 'name', this.value)" /></div>
                <div><small>Preis (€):</small><input type="number" step="0.01" value="${item.price.toFixed(2)}" onchange="updateItem(${item.id}, 'price', this.value)" /></div>
                <div><small>Indiv. Limit:</small><input type="number" value="${item.max_limit || ''}" placeholder="Kein" onchange="updateItem(${item.id}, 'max_limit', this.value)" /></div>
                <div>
                    <small>Kategorie:</small>
                    <select onchange="updateItem(${item.id}, 'category', this.value)">
                        <option value="">Keine</option>
                        ${categories.map(cat => `
                            <option value="${cat.name}" ${item.category === cat.name ? 'selected' : ''}>${cat.name}</option>
                        `).join("")}
                    </select>
                </div>
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

async function updateCategory(name, value) {
    const limit = value === "" ? null : parseInt(value);
    await fetch(`/api/admin/categories/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_limit: limit })
    });
    loadAdminData();
}

async function deleteCategory(name) {
    if (!confirm(`Kategorie "${name}" wirklich löschen? Produkte bleiben erhalten, verlieren aber die Zuordnung.`)) return;
    await fetch(`/api/admin/categories/${name}`, { method: "DELETE" });
    loadAdminData();
}

async function updateItem(id, field, value) {
    // Optimization: Don't fetch everything again, just find in local cache or send update
    const response = await fetch("/api/admin/menu");
    const items = await response.json();
    const item = items.find(i => i.id === id);
    if (!item) return;

    const updatedData = {
        name: field === 'name' ? value : item.name,
        price: field === 'price' ? parseFloat(value) : item.price,
        active: field === 'active' ? (value === true || value === 1) : !!item.active,
        max_limit: field === 'max_limit' ? (value === "" ? null : parseInt(value)) : item.max_limit,
        category: field === 'category' ? (value === "" ? null : value) : item.category
    };

    await fetch(`/api/admin/menu/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData)
    });
    loadAdminData();
}

async function deleteItem(id) {
    if (!confirm("Sicher löschen?")) return;
    await fetch(`/api/admin/menu/${id}`, { method: "DELETE" });
    loadAdminData();
}

document.getElementById("add-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("cat-name").value;
    const max_limit = document.getElementById("cat-limit").value ? parseInt(document.getElementById("cat-limit").value) : null;
    
    await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, max_limit })
    });
    
    e.target.reset();
    loadAdminData();
});

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
    loadAdminData();
});

loadAdminData();
