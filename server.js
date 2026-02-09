const express = require("express");
const session = require("express-session");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ORDER_PASSWORD = process.env.BESTELL_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "bestellsystem-secret";

const menuItems = [
  { name: "Pizza Margherita", price: 2.0 },
  { name: "Pizza Mozzarella", price: 2.50 },
  { name: "Brezel", price: 10.0 },
  { name: "Spezi", price: 1.0 },
  { name: "Cola", price: 1.0 },
  { name: "Fanta", price: 1.0 },
  { name: "Sprite", price: 1.0 },
  { name: "Apfelschorle", price: 1.0 },
  { name: "Wassereis", price: 0.20 },
  { name: "Kinderriegel", price: 0.30 },
  { name: "Schokobrötchen", price: 0.30 },
  { name: "Haribo", price: 0.10 }

];

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
    createdAt: order.createdAt,
    completed: order.completed
  };
}

function broadcastOrders() {
  const activeOrders = Array.from(orders.values())
    .filter((order) => !order.completed)
    .map(serializeOrder);
  io.to("kitchen").emit("orders:update", activeOrders);
  io.to("staff").emit("orders:update", activeOrders);
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
      <a href="/"><button type="button">Zurück zur Startseite</button></a>
    </header>
    <section class="grid">
      <div class="card">
        <h2>Neue Bestellung</h2>
        <form id="order-form">
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

app.get("/api/menu", (req, res) => {
  res.json(menuItems);
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  res.json(serializeOrder(order));
});

app.post("/api/orders", async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ message: "Keine Artikel" });
    return;
  }
  const id = generateOrderId();
  if (!id) {
    res.status(500).json({ message: "Keine ID verfügbar" });
    return;
  }

  const orderItems = items.map((item) => ({
    name: item.name,
    price: Number(item.price),
    qty: Number(item.qty),
    done: false
  }));

  const total = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const order = {
    id,
    items: orderItems,
    total: Number(total.toFixed(2)),
    createdAt: new Date().toISOString(),
    completed: false
  };

  orders.set(id, order);
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

app.post("/api/orders/:id/items/:index/toggle", (req, res) => {
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
  }

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
    if (role === "order" && orderId) {
      socket.join(`order:${orderId}`);
      const order = orders.get(orderId);
      if (order) {
        updateCustomer(order);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`BestellSystem läuft auf http://localhost:${PORT}`);
});
