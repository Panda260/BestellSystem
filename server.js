const express = require("express");
const session = require("express-session");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const db = require("./database");


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ORDER_PASSWORD = process.env.BESTELL_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "bestellsystem-secret";

// Global orders Map for real-time tracking (synced with DB)
const orders = new Map();


app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));

function renderPage({ title, body, scripts = [] }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/public/styles.css" />
</head>
<body>
  <div class="container">
    ${body}
  </div>
  <script src="/socket.io/socket.io.js"></script>
  ${scripts.map((src) => `<script src="${src}"></script>`).join("\n")}
</body>
</html>`;
}

function generateOrderId() {
  const maxAttempts = 1000;
  for (let i = 0; i < maxAttempts; i += 1) {
    const id = Math.floor(100 + Math.random() * 900).toString();
    if (!orders.has(id)) {
      return id;
    }
  }
  return null;
}

function serializeOrder(order) {
  return {
    id: order.id,
    items: order.items,
    total: order.total,
    customerName: order.customerName,
    createdAt: order.createdAt,
    completed: order.completed,
    inOven: !!order.inOven
  };
}


function broadcastOrders() {
  const allActiveOrders = Array.from(orders.values())
    .map(serializeOrder);
  
  // Kitchen and Staff might only want non-completed, but TV needs both.
  // We'll send everything and let the client decide.
  io.to("kitchen").emit("orders:update", allActiveOrders.filter(o => !o.completed));
  io.to("staff").emit("orders:update", allActiveOrders.filter(o => !o.completed));
  io.to("tv").emit("orders:update", allActiveOrders);
}


function updateCustomer(order) {
  io.to(`order:${order.id}`).emit("order:update", serializeOrder(order));
}

app.get("/", (req, res) => {
  const body = `
    <header class="page-header">
      <h1>BestellSystem</h1>
      <p>Gib deine Bestell-ID ein, um den Status zu sehen.</p>
    </header>
    <form id="status-form" class="card">
      <label for="order-id">Bestell-ID (3-stellig)</label>
      <input id="order-id" name="order-id" type="text" maxlength="3" pattern="\\d{3}" required />
      <button type="submit">Status anzeigen</button>
    </form>
    <p class="hint">Oder scanne den QR-Code, den du bei der Bestellung erhalten hast.</p>
    <div class="card">
      <a href="/bestellen"><button type="button">Zur Bestellseite</button></a>
    </div>
  `;
  res.send(
    renderPage({
      title: "BestellSystem",
      body,
      scripts: ["/public/start.js"]
    })
  );
});

app.get("/admin", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/bestellen");
    return;
  }
  const body = `
    <header class="page-header">
      <h1>Produkte verwalten</h1>
      <div class="header-actions">
        <a href="/bestellen" class="button secondary">Zurück</a>
      </div>
    </header>
    <div class="admin-container">
      <div class="card full-width">
        <h2>Produktliste</h2>
        <div id="admin-menu-list"></div>
      </div>

      <div class="grid">
        <div class="card">
          <h2>Kategorien verwalten</h2>
          <form id="add-category-form">
            <input id="cat-name" type="text" placeholder="Kategoriename (z.B. Pizza)" required />
            <input id="cat-limit" type="number" placeholder="Max Limit" />
            <button type="submit">Kategorie hinzufügen</button>
          </form>
          <div id="admin-category-list" class="stats-table-container"></div>
        </div>

        <div class="card">
          <h2>Neues Produkt hinzufügen</h2>
          <form id="add-product-form">
            <label for="new-name">Name</label>
            <input id="new-name" type="text" required />
            <label for="new-price">Preis (€)</label>
            <input id="new-price" type="number" step="0.01" required />
            <label for="new-limit">Max Limit (optional, 12:30-13:45)</label>
            <input id="new-limit" type="number" step="1" />
            <label for="new-category">Kategorie</label>
            <select id="new-category">
              <option value="">Keine</option>
              <!-- Categories will be added here by JS -->
            </select>
            <button type="submit">Hinzufügen</button>
          </form>
        </div>
      </div>
    </div>

  `;
  res.send(renderPage({ 
    title: "Admin - Produkte", 
    body, 
    scripts: ["/public/admin.js"] 
  }));
});

app.get("/tv", (req, res) => {
  const body = `
    <header class="page-header tv-header">
      <h1>Bestellstatus</h1>
    </header>
    <div class="tv-grid">
      <div class="tv-column">
        <h2>In Arbeit</h2>
        <div id="tv-pending" class="tv-list"></div>
      </div>
      <div class="tv-column">
        <h2>Abholbereit</h2>
        <div id="tv-ready" class="tv-list"></div>
      </div>
    </div>
  `;
  res.send(renderPage({ 
    title: "BestellSystem TV", 
    body, 
    scripts: ["/public/tv.js"] 
  }));
});


app.get("/statistik", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/bestellen");
    return;
  }
  const body = `
    <header class="page-header">
      <h1>Statistik</h1>
      <div class="header-actions">
        <a href="/bestellen" class="button secondary">Zurück</a>
        <button id="reset-stats-btn" class="button danger">Statistik zurücksetzen</button>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Übersicht Heute</h2>
        <div id="stats-today"></div>
      </div>
      <div class="card">
        <h2>Gesamtstatistik</h2>
        <div id="stats-total"></div>
      </div>
    </div>
  `;
  res.send(renderPage({ 
    title: "Statistik", 
    body, 
    scripts: ["/public/stats.js"] 
  }));
});

app.get("/bestellen", (req, res) => {

  if (!req.session?.isAuthenticated) {
    const body = `
      <header class="page-header">
        <h1>Bestellen (geschützt)</h1>
        <p>Bitte Passwort eingeben.</p>
      </header>
      <form class="card" method="post" action="/bestellen/login">
        <label for="password">Passwort</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Einloggen</button>
      </form>
    `;
    res.send(renderPage({ title: "Bestellen", body }));
    return;
  }

  const body = `
    <header class="page-header">
      <h1>Bestellungen aufnehmen</h1>
      <p>Neue Bestellungen aufnehmen und bestehende Bestellungen bearbeiten.</p>
      <div class="header-actions">
        <a href="/"><button type="button">Zur Startseite</button></a>
        <a href="/admin"><button type="button" class="secondary">Produkte bearbeiten</button></a>
        <a href="/statistik"><button type="button" class="secondary">Statistik</button></a>
      </div>
    </header>


    <section class="grid">
      <div class="card">
        <h2>Neue Bestellung</h2>
        <form id="order-form">
          <label for="customer-name">Name</label>
          <input id="customer-name" name="customer-name" type="text" placeholder="Kundenname..." required />
          <div id="menu"></div>
          <div class="total-row">
            <span>Gesamtpreis:</span>
            <strong id="total">0.00 €</strong>
          </div>
          <button type="submit">Bestellung aufgeben</button>
        </form>

        <div id="order-result" class="order-result"></div>
      </div>
      <div class="card">
        <h2>Offene Bestellungen</h2>
        <div id="staff-orders" class="orders"></div>
      </div>
    </section>
  `;

  res.send(
    renderPage({
      title: "Bestellen",
      body,
      scripts: ["/public/bestellen.js"]
    })
  );
});

app.post("/bestellen/login", express.urlencoded({ extended: true }), (req, res) => {
  const { password } = req.body;
  if (password === ORDER_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect("/bestellen");
    return;
  }
  res.status(401).send(
    renderPage({
      title: "Bestellen",
      body: `
        <header class="page-header">
          <h1>Zugriff verweigert</h1>
          <p>Passwort stimmt nicht.</p>
        </header>
        <a class="button" href="/bestellen">Zurück</a>
      `
    })
  );
});

app.get("/bestellungen", (req, res) => {
  const body = `
    <header class="page-header">
      <h1>Küchenanzeige</h1>
      <p>Live Übersicht aller offenen Bestellungen.</p>
    </header>
    <div id="kitchen-orders" class="orders"></div>
  `;

  res.send(
    renderPage({
      title: "Bestellungen",
      body,
      scripts: ["/public/bestellungen.js"]
    })
  );
});

app.get("/api/menu", async (req, res) => {
  try {
    const items = await db.getMenuItems(true);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/menu", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    const items = await db.getMenuItems(false);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/menu", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { name, price } = req.body;
  try {
    const id = await db.addMenuItem(name, price);
    res.status(201).json({ id, name, price, active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/categories", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    const cats = await db.getCategories();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/categories", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { name, max_limit } = req.body;
  try {
    await db.addCategory(name, max_limit);
    res.status(201).json({ name, max_limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/categories/:name", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { max_limit } = req.body;
  try {
    await db.updateCategory(req.params.name, max_limit);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/categories/:name", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    await db.deleteCategory(req.params.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/menu/:id", async (req, res) => {

  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { name, price, active, max_limit, category } = req.body;
  try {
    await db.updateMenuItem(req.params.id, name, price, active, max_limit, category);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await db.getOrderStats(today);
    const totalStats = await db.getOrderStats();
    res.json({ today: todayStats, total: totalStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/stats", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    await db.resetStats();
    orders.clear(); // Clear memory map too
    broadcastOrders(); // Notify anyone watching
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/limits", async (req, res) => {

  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await db.getOrderStats(today);
    const menu = await db.getMenuItems(true);
    
    const results = menu.map(item => {
      const usage = todayStats[item.name] || 0;
      return {
        name: item.name,
        category: item.category,
        max_limit: item.max_limit,
        current_usage: usage
      };
    });

    // Also calculate category usage
    const categoryUsage = {};
    results.forEach(r => {
      if (r.category) {
        categoryUsage[r.category] = (categoryUsage[r.category] || 0) + r.current_usage;
      }
    });

    res.json({ items: results, categories: categoryUsage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.delete("/api/admin/menu/:id", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    await db.deleteMenuItem(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  res.json(serializeOrder(order));
});


app.get("/api/orders/:id/qr", async (req, res) => {
  const orderId = req.params.id;
  const order = orders.get(orderId);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  const orderUrl = `${req.protocol}://${req.get("host")}/${orderId}`;
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(orderUrl);
    res.json({ qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/orders", async (req, res) => {
  const { items, customerName } = req.body;

  // Limit check
  const now = new Date();
  const startLimit = new Date();
  startLimit.setHours(12, 30, 0);
  const endLimit = new Date();
  endLimit.setHours(13, 45, 0);

  if (now >= startLimit && now <= endLimit) {
    const today = now.toISOString().split('T')[0];
    const todayStats = await db.getOrderStats(today);
    const menu = await db.getMenuItems(true);
    const categories = await db.getCategories();
    
    // Group by item name and category
    const categoryUsage = {};
    const itemUsage = {};
    Object.keys(todayStats).forEach(name => {
      const menuItem = menu.find(m => m.name === name);
      if (menuItem) {
        if (menuItem.category) {
          categoryUsage[menuItem.category] = (categoryUsage[menuItem.category] || 0) + todayStats[name];
        }
        itemUsage[name] = (itemUsage[name] || 0) + todayStats[name];
      }
    });

    // Check limits for new items
    for (const item of items) {
      const menuItem = menu.find(m => m.name === item.name);
      if (!menuItem) continue;

      // 1. Check item-specific limit
      if (menuItem.max_limit) {
        const currentQty = itemUsage[item.name] || 0;
        if (currentQty + 1 > menuItem.max_limit) {
          return res.status(400).json({ message: `Limit für ${item.name} überschritten!` });
        }
      }

      // 2. Check category limit
      if (menuItem.category) {
        const cat = categories.find(c => c.name === menuItem.category);
        if (cat && cat.max_limit) {
          const currentCatQty = categoryUsage[menuItem.category] || 0;
          if (currentCatQty + 1 > cat.max_limit) {
            return res.status(400).json({ message: `Kategorielimit für ${menuItem.category} überschritten!` });
          }
        }
      }
    }
  }



  if (!customerName || typeof customerName !== 'string' || customerName.trim() === '') {
    res.status(400).json({ message: "Name ist erforderlich" });
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ message: "Keine Artikel" });
    return;
  }
  const id = generateOrderId();
  if (!id) {
    res.status(500).json({ message: "Keine ID verfügbar" });
    return;
  }

  const orderItems = [];
  items.forEach((item) => {
    const qty = Number(item.qty);
    for (let i = 0; i < qty; i++) {
      orderItems.push({
        name: item.name,
        price: Number(item.price), // Note: total is price * 1 here, but we'll sum later
        qty: 1,
        done: false
      });
    }
  });

  const total = orderItems.reduce((sum, item) => sum + item.price, 0);

  const order = {
    id,
    items: orderItems,
    total: Number(total.toFixed(2)),
    customerName: customerName || null,
    createdAt: new Date().toISOString(),
    completed: false,
    inOven: false
  };

  orders.set(id, order);
  await db.saveOrder(order);
  broadcastOrders();
  updateCustomer(order);

  const orderUrl = `${req.protocol}://${req.get("host")}/${id}`;
  const qrCodeDataUrl = await QRCode.toDataURL(orderUrl);

  res.status(201).json({
    id,
    qrCodeDataUrl,
    order: serializeOrder(order)
  });
});


app.post("/api/orders/:id/items/:index/toggle", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= order.items.length) {
    res.status(400).json({ message: "Ungültiger Index" });
    return;
  }
  order.items[index].done = !order.items[index].done;
  order.completed = order.items.every((item) => item.done);

  if (order.completed) {
    order.completedAt = new Date().toISOString();
  } else {
    order.completedAt = null;
  }

  await db.updateOrderItems(order.id, order.items, order.completed, order.completedAt);
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});

app.post("/api/orders/:id/toggle-oven", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  order.inOven = !order.inOven;

  await db.updateOrderOven(order.id, order.inOven);
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});


app.get("/:orderId", (req, res, next) => {
  if (!/^\d{3}$/.test(req.params.orderId)) {
    next();
    return;
  }
  const body = `
    <header class="page-header">
      <h1>Bestellstatus</h1>
      <p>Bestell-ID <strong id="order-id">${req.params.orderId}</strong></p>
    </header>
    <div id="status" class="card"></div>
  `;
  res.send(
    renderPage({
      title: `Status ${req.params.orderId}`,
      body,
      scripts: ["/public/status.js"]
    })
  );
});

app.use((req, res) => {
  res.status(404).send(
    renderPage({
      title: "Nicht gefunden",
      body: `
        <header class="page-header">
          <h1>404</h1>
          <p>Diese Seite gibt es nicht.</p>
        </header>
        <a class="button" href="/">Zur Startseite</a>
      `
    })
  );
});

io.on("connection", (socket) => {
  socket.on("join", ({ role, orderId }) => {
    if (role === "kitchen") {
      socket.join("kitchen");
      broadcastOrders();
      return;
    }
    if (role === "staff") {
      socket.join("staff");
      broadcastOrders();
      return;
    }
    if (role === "tv") {
      socket.join("tv");
      broadcastOrders();
      return;
    }
    if (role === "order" && orderId) {

      socket.join(`order:${orderId}`);
      const order = orders.get(orderId);
      if (order) {
        updateCustomer(order);
      }
    }
  });
});

server.listen(PORT, async () => {
  try {
    await db.initDb();
    const openOrders = await db.getAllOrders(true);
    openOrders.forEach(o => orders.set(o.id, o));
    console.log(`BestellSystem läuft auf http://localhost:${PORT}`);
  } catch (err) {
    console.error("Fehler beim Starten der Datenbank:", err);
  }
});

