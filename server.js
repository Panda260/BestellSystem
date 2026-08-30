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
// Global Set to track all generated IDs, preventing collisions even after orders are picked up
const usedOrderIds = new Set();


app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));

function renderPage({ title, body, scripts = [], back = null, actions = "", bodyClass = "" }) {
  const backHtml = back
    ? `<a href="${back}" class="topbar-back" aria-label="Zurück"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></a>`
    : "";
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="theme-color" content="#ffffff" />
  <title>${title}</title>
  <link rel="stylesheet" href="/public/styles.css" />
</head>
<body class="${bodyClass}">
  <header class="topbar">
    ${backHtml}
    <div class="topbar-title">${title}</div>
    <div class="topbar-actions">${actions}</div>
  </header>
  <main class="main">
    ${body}
  </main>
  <script src="/socket.io/socket.io.js"></script>
  ${scripts.map((src) => `<script src="${src}"></script>`).join("\n")}
</body>
</html>`;
}

// Settings gear icon (reused across pages)
const SETTINGS_GEAR = `<button type="button" class="icon-btn" id="settings-btn" aria-label="Menü"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
<div id="settings-menu" class="settings-menu hidden">
  <a href="/admin">Produkte</a>
  <a href="/statistik">Statistik</a>
  <a href="/namen">Namen</a>
  <a href="/tv-einstellungen">TV-Einstellungen</a>
  <a href="/verlauf">Verlauf</a>
</div>`;

const SETTINGS_TOGGLE_JS = `<script>
(function(){
  var btn=document.getElementById('settings-btn');
  var menu=document.getElementById('settings-menu');
  if(!btn||!menu)return;
  btn.addEventListener('click',function(e){e.stopPropagation();menu.classList.toggle('hidden');});
  document.addEventListener('click',function(e){if(!menu.contains(e.target)&&e.target!==btn)menu.classList.add('hidden');});
})();
</script>`;

function generateOrderId() {
  let min = 100;
  let max = 999;
  let attempts = 0;
  
  while (true) {
    const id = Math.floor(min + Math.random() * (max - min + 1)).toString();
    if (!usedOrderIds.has(id)) {
      return id;
    }
    attempts++;
    if (attempts > 50) {
      // Wenn es zu viele Kollisionen gibt (Bereich fast voll), erhöhe die Stellenanzahl (z.B. auf 4-stellig: 1000-9999)
      min *= 10;
      max = max * 10 + 9;
      attempts = 0;
    }
  }
}

function serializeOrder(order) {
  // Derive order-level inOven from items (any item in oven -> order in oven)
  const anyInOven = order.items.some((i) => i.inOven);
  return {
    id: order.id,
    items: order.items,
    total: order.total,
    customerName: order.customerName,
    createdAt: order.createdAt,
    completed: order.completed,
    inOven: anyInOven,
    pickedUp: !!order.pickedUp
  };
}


function broadcastOrders() {
  const allActiveOrders = Array.from(orders.values())
    .filter(o => !o.pickedUp)
    .map(serializeOrder);
  
  // Kitchen sees only not completed
  io.to("kitchen").emit("orders:update", allActiveOrders.filter(o => !o.completed));
  // Staff sees everything not picked up (to mark them as picked up)
  io.to("staff").emit("orders:update", allActiveOrders);
  // TV sees everything not picked up
  io.to("tv").emit("orders:update", allActiveOrders);
}


function updateCustomer(order) {
  io.to(`order:${order.id}`).emit("order:update", serializeOrder(order));
}

app.get("/", (req, res) => {
  if (!req.session?.isAuthenticated) {
    const body = `
      <form class="card login-card" method="post" action="/enter">
        <h2>BestellSystem</h2>
        <p class="hint">Gib deine Bestell-ID ein, um den Status zu sehen.</p>
        <label for="enter-input">Bestell-ID</label>
        <input id="enter-input" name="value" type="text" required autofocus placeholder="Bestell-ID" />
        <button type="submit">Status anzeigen</button>
      </form>
    `;
    res.send(renderPage({ title: "BestellSystem", body }));
    return;
  }

  const body = `
    <div id="search-bar" class="search-bar hidden">
      <input id="order-search" type="text" placeholder="Name oder Bestell-ID suchen..." autocomplete="off" />
      <button id="search-close" class="search-close" aria-label="Schließen">&times;</button>
    </div>
    <a href="/bestellen" class="big-cta">+ Bestellung aufgeben</a>
    <section class="card">
      <h2>Offene Bestellungen</h2>
      <div id="staff-orders" class="orders"></div>
    </section>
  `;
  const searchIcon = `<button type="button" class="icon-btn" id="search-btn" aria-label="Suchen"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>`;
  res.send(
    renderPage({
      title: "BestellSystem",
      body,
      actions: searchIcon + SETTINGS_GEAR + SETTINGS_TOGGLE_JS,
      scripts: ["/public/home.js"]
    })
  );
});

// Combined entry: order ID -> status page, admin password -> admin UI
app.post("/enter", express.urlencoded({ extended: true }), (req, res) => {
  const value = (req.body.value || "").trim();
  if (value === ORDER_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect(req.session.redirectAfterLogin || "/");
    delete req.session.redirectAfterLogin;
    return;
  }
  if (/^\d+$/.test(value)) {
    res.redirect(`/${value}`);
    return;
  }
  res.status(400).send(
    renderPage({
      title: "Ungültige Eingabe",
      body: `
        <div class="card login-card">
          <h2>Ungültige Eingabe</h2>
          <p class="hint">Bitte eine gültige Bestell-ID (Zahlen) eingeben.</p>
          <a class="button" href="/">Zurück</a>
        </div>
      `
    })
  );
});

app.get("/admin", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/");
    return;
  }
  const body = `
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
            </select>
            <button type="submit">Hinzufügen</button>
          </form>
        </div>
      </div>
    </div>
  `;
  res.send(renderPage({
    title: "Produkte",
    body,
    back: "/",
    scripts: ["/public/admin.js"]
  }));
});

app.get("/tv", (req, res) => {
  const now = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const body = `<h1 class="tv-title">Aktuelle Bestellungen</h1><div id="tv-list" class="tv-list"></div><div id="tv-clock" class="tv-clock">${now}</div>`;
  res.send(renderPage({
    title: "TV-Anzeige",
    body,
    bodyClass: "tv-view",
    scripts: ["/public/tv.js"]
  }));
});

app.get("/tv-einstellungen", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/");
    return;
  }
  const body = `
    <div class="tv-settings">
      <h2>TV-Einstellungen</h2>
      <p class="hint">Passe die Farben der TV-Anzeige an. Änderungen werden sofort gespeichert.</p>
      <div class="settings-color-grid">
        <label class="color-picker-row">
          <span>Hintergrund</span>
          <input type="color" id="tv-bg" data-key="bgColor" />
        </label>
        <label class="color-picker-row">
          <span>Box: Wartend</span>
          <input type="color" id="tv-box-waiting" data-key="boxWaiting" />
        </label>
        <label class="color-picker-row">
          <span>Box: Im Ofen</span>
          <input type="color" id="tv-box-oven" data-key="boxOven" />
        </label>
        <label class="color-picker-row">
          <span>Tag: Im Ofen</span>
          <input type="color" id="tv-tag-oven" data-key="tagOven" />
        </label>
        <label class="color-picker-row">
          <span>Box: Abholbereit</span>
          <input type="color" id="tv-box-ready" data-key="boxReady" />
        </label>
        <label class="color-picker-row">
          <span>Tag: Abholbereit</span>
          <input type="color" id="tv-tag-ready" data-key="tagReady" />
        </label>
        <label class="color-picker-row">
          <span>Textfarbe Wartend</span>
          <input type="color" id="tv-text-waiting" data-key="textWaiting" />
        </label>
        <label class="color-picker-row">
          <span>Textfarbe Im Ofen</span>
          <input type="color" id="tv-text-oven" data-key="textOven" />
        </label>
        <label class="color-picker-row">
          <span>Textfarbe Abholbereit</span>
          <input type="color" id="tv-text-ready" data-key="textReady" />
        </label>
        <label class="color-picker-row">
          <span>Titel</span>
          <input type="color" id="tv-title-color" data-key="titleColor" />
        </label>
        <label class="color-picker-row">
          <span>Uhrzeit</span>
          <input type="color" id="tv-clock-color" data-key="clockColor" />
        </label>
      </div>
      <button id="tv-settings-reset" class="button secondary">Auf Standard zurücksetzen</button>
      <p id="tv-settings-saved" class="hint" style="opacity:0;">Gespeichert!</p>
      <a href="/tv" class="button" style="margin-top:16px;display:inline-block;">TV-Anzeige ansehen</a>
    </div>
  `;
  res.send(renderPage({
    title: "TV-Einstellungen",
    body,
    back: "/",
    scripts: ["/public/tv-settings.js"]
  }));
});

// API: Get TV settings
app.get("/api/tv-settings", async (req, res) => {
  try {
    const settings = await db.getTvSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Einstellungen" });
  }
});

// API: Update TV setting
app.post("/api/tv-settings", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).json({ error: "Nicht autorisiert" });
  const { key, value } = req.body;
  if (!key || !value) return res.status(400).json({ error: "key und value erforderlich" });
  try {
    await db.setTvSetting(key, value);
    io.emit("tv-settings:update");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern" });
  }
});


app.get("/statistik", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/");
    return;
  }
  const body = `
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
    <div class="grid">
      <div class="card">
        <h2>Bestellungen pro Person (Heute)</h2>
        <div id="customer-stats-today"></div>
      </div>
      <div class="card">
        <h2>Bestellungen pro Person (Gesamt)</h2>
        <div id="customer-stats-total"></div>
      </div>
    </div>
    <button id="reset-stats-btn" class="button danger">Statistik zurücksetzen</button>
  `;
  res.send(renderPage({
    title: "Statistik",
    body,
    back: "/",
    actions: `<a href="/statistik-lifetime" class="button secondary small">Lifetime</a>`,
    scripts: ["/public/stats.js"]
  }));
});

app.get("/statistik-lifetime", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/");
    return;
  }
  const body = `
    <div class="grid">
      <div class="card full-width">
        <h2>Lifetime-Statistik (nicht löschbar)</h2>
        <div id="stats-lifetime"></div>
      </div>
    </div>
  `;
  res.send(renderPage({
    title: "Lifetime-Statistik",
    body,
    back: "/statistik",
    scripts: ["/public/stats-lifetime.js"]
  }));
});

app.get("/bestellen", (req, res) => {

  if (!req.session?.isAuthenticated) {
    req.session.redirectAfterLogin = "/bestellen";
    const body = `
      <form class="card login-card" method="post" action="/bestellen/login">
        <h2>Bestellen (geschützt)</h2>
        <p class="hint">Bitte Passwort eingeben.</p>
        <label for="password">Passwort</label>
        <input id="password" name="password" type="password" required autofocus />
        <button type="submit">Einloggen</button>
      </form>
    `;
    res.send(renderPage({ title: "Bestellen", body }));
    return;
  }

  const body = `
    <div id="wizard" class="wizard">
      <section class="wizard-step" id="step-name">
        <h2>Wer bestellt?</h2>
        <button id="to-items-btn" class="big-cta" type="button" disabled>Weiter</button>
        <div class="autocomplete-wrap">
          <input id="customer-name" type="text" placeholder="Name eingeben..." autocomplete="off" autofocus />
        </div>
        <div id="all-names" class="all-names"></div>
      </section>

      <section class="wizard-step hidden" id="step-items">
        <div class="wizard-name-row">
          <h2>Was bestellt <span id="name-display"></span>?</h2>
          <button type="button" class="button secondary small" id="change-name-btn">Name ändern</button>
        </div>
        <div id="menu" class="menu-grid"></div>
        <div class="total-row">
          <span>Gesamt:</span>
          <strong id="total">0,00 €</strong>
        </div>
        <button id="submit-order-btn" class="big-cta" type="button" disabled>Bestellung aufgeben</button>
        <div id="order-result" class="order-result"></div>
      </section>
    </div>
  `;

  res.send(
    renderPage({
      title: "Neue Bestellung",
      body,
      back: "/",
      scripts: ["/public/bestellen.js"]
    })
  );
});

app.get("/namen", (req, res) => {
  if (!req.session?.isAuthenticated) {
    req.session.redirectAfterLogin = "/namen";
    res.redirect("/");
    return;
  }
  const body = `
    <div class="card">
      <h2>Neuen Namen hinzufügen</h2>
      <form id="add-name-form" class="inline-form">
        <input id="new-name" type="text" placeholder="Name..." required />
        <button type="submit">Hinzufügen</button>
      </form>
    </div>
    <div class="card">
      <h2>Gespeicherte Namen</h2>
      <input id="name-filter" type="text" placeholder="Suchen..." />
      <div id="names-list" class="names-list"></div>
    </div>
  `;
  res.send(renderPage({ title: "Namen", body, back: "/", scripts: ["/public/names.js"] }));
});

app.get("/status", (req, res) => {
  const body = `
    <form id="status-form" class="card login-card">
      <h2>Bestellstatus</h2>
      <p class="hint">Gib deine Bestell-ID ein.</p>
      <label for="order-id">Bestell-ID</label>
      <input id="order-id" name="order-id" type="text" pattern="\\d+" required />
      <button type="submit">Status anzeigen</button>
    </form>
    <p class="hint" style="text-align:center">Oder scanne den QR-Code.</p>
  `;
  res.send(
    renderPage({
      title: "Status",
      body,
      back: "/",
      scripts: ["/public/start.js"]
    })
  );
});

app.post("/bestellen/login", express.urlencoded({ extended: true }), (req, res) => {
  const { password } = req.body;
  if (password === ORDER_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect(req.session.redirectAfterLogin || "/");
    delete req.session.redirectAfterLogin;
    return;
  }
  res.status(401).send(
    renderPage({
      title: "Zugriff verweigert",
      body: `
        <div class="card login-card">
          <h2>Zugriff verweigert</h2>
          <p class="hint">Passwort stimmt nicht.</p>
          <a class="button" href="/">Zurück</a>
        </div>
      `
    })
  );
});

app.get("/bestellungen", (req, res) => {
  const body = `<div id="kitchen-orders" class="orders"></div>`;
  res.send(
    renderPage({
      title: "Küche",
      body,
      back: "/",
      scripts: ["/public/bestellungen.js"]
    })
  );
});

app.get("/verlauf", (req, res) => {
  if (!req.session?.isAuthenticated) {
    res.redirect("/");
    return;
  }
  const body = `
    <button id="clear-history-btn" class="button danger" onclick="clearHistory()">Verlauf leeren</button>
    <div id="history-orders" class="orders history-orders"></div>
  `;
  res.send(
    renderPage({
      title: "Verlauf",
      body,
      back: "/",
      scripts: ["/public/verlauf.js"]
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

// ---- Customer names (autocomplete) ----
app.get("/api/names", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    const names = await db.getCustomerNames();
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/names/search", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    const q = (req.query.q || "").trim();
    if (!q) {
      const names = await db.getCustomerNames();
      return res.json(names);
    }
    const names = await db.searchCustomerNames(q);
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/names", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { name } = req.body;
  try {
    const id = await db.addCustomerName(name);
    if (!id) return res.status(409).json({ message: "Name existiert bereits" });
    res.status(201).json({ id, name: (name || "").trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/names/:id", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const { name } = req.body;
  try {
    await db.updateCustomerName(req.params.id, name);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/names/:id", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    await db.deleteCustomerName(req.params.id);
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
    const lifetimeStats = await db.getLifetimeStats();
    const todayCustomerStats = await db.getCustomerStats(today);
    const totalCustomerStats = await db.getCustomerStats();
    res.json({ today: todayStats, total: totalStats, lifetime: lifetimeStats, todayCustomers: todayCustomerStats, totalCustomers: totalCustomerStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/stats", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  try {
    await db.resetStats();
    orders.clear(); // Clear memory map too
    usedOrderIds.clear(); // Clear used ids set
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
        price: Number(item.price),
        qty: 1,
        done: false,
        pickedUp: false,
        inOven: false
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
    inOven: false,
    pickedUp: false
  };

  orders.set(id, order);
  usedOrderIds.add(id);
  
  try {
    await db.saveOrder(order);
    // Auto-save customer name for autocomplete (best-effort)
    if (order.customerName) {
      try { await db.addCustomerName(order.customerName); } catch (_) {}
    }
  } catch (err) {
    orders.delete(id);
    usedOrderIds.delete(id);
    console.error("Fehler beim Speichern der Bestellung in DB:", err);
    return res.status(500).json({ message: "Datenbankfehler: Konnte Bestellung nicht speichern." });
  }

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

// Per-item oven toggle
app.post("/api/orders/:id/items/:index/toggle-oven", async (req, res) => {
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
  order.items[index].inOven = !order.items[index].inOven;

  await db.updateOrderItems(order.id, order.items, order.completed, order.completedAt);
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});

app.post("/api/orders/:id/items/:index/pickup", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
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
  
  order.items[index].pickedUp = true;
  
  // Wenn alle Items abgeholt wurden, ist die gesamte Bestellung abgeholt
  if (order.items.every(item => item.pickedUp)) {
    order.pickedUp = true;
    order.pickedUpAt = new Date().toISOString();
    await db.updateOrderPickedUp(order.id, order.pickedUp, order.pickedUpAt);
  }
  
  await db.updateOrderItems(order.id, order.items, order.completed, order.completedAt);
  
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});

app.post("/api/orders/:id/pickup", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Nicht gefunden" });
    return;
  }
  order.pickedUp = true;
  order.pickedUpAt = new Date().toISOString();

  await db.updateOrderPickedUp(order.id, order.pickedUp, order.pickedUpAt);
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});

app.post("/api/orders/:id/reopen", async (req, res) => {
  if (!req.session?.isAuthenticated) return res.status(401).send();

  // order might not be in memory if server restarted
  let order = orders.get(req.params.id);
  if (!order) {
      order = await db.getOrderById(req.params.id);
      if (!order) {
          return res.status(404).json({ message: "Nicht gefunden" });
      }
      orders.set(order.id, order);
  }

  // Reset all items: not done, not in oven, not picked up
  order.items = order.items.map((item) => ({
    ...item,
    done: false,
    inOven: false,
    pickedUp: false,
  }));
  order.pickedUp = false;
  order.pickedUpAt = null;
  order.completed = false;
  order.completedAt = null;

  await db.updateOrderItems(order.id, order.items, false, null);
  await db.updateOrderPickedUp(order.id, false, null);
  broadcastOrders();
  updateCustomer(order);

  res.json(serializeOrder(order));
});

app.get("/api/orders/history/today", async (req, res) => {
    if (!req.session?.isAuthenticated) return res.status(401).send();
    try {
        const today = new Date().toISOString().split('T')[0];
        const pickedUpOrders = await db.getPickedUpOrders(today);
        res.json(pickedUpOrders.map(serializeOrder));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/orders/history", async (req, res) => {
    if (!req.session?.isAuthenticated) return res.status(401).send();
    try {
        await db.clearHistory();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/:orderId", (req, res, next) => {
  if (!/^\d+$/.test(req.params.orderId)) {
    next();
    return;
  }
  const body = `
    <p class="hint">Bestell-ID <strong id="order-id">${req.params.orderId}</strong></p>
    <div id="status" class="card"></div>
  `;
  res.send(
    renderPage({
      title: `Status ${req.params.orderId}`,
      body,
      back: "/status",
      scripts: ["/public/status.js"]
    })
  );
});

app.use((req, res) => {
  res.status(404).send(
    renderPage({
      title: "404",
      body: `
        <div class="card login-card">
          <h2>404</h2>
          <p class="hint">Diese Seite gibt es nicht.</p>
          <a class="button" href="/">Zur Startseite</a>
        </div>
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
    const allOrders = await db.getAllOrders(false); // onlyOpen=false -> fetch all to populate usedOrderIds
    allOrders.forEach(o => {
      usedOrderIds.add(o.id);
      if (!o.pickedUp) {
        orders.set(o.id, o);
      }
    });
    console.log(`BestellSystem läuft auf http://localhost:${PORT}`);
  } catch (err) {
    console.error("Fehler beim Starten der Datenbank:", err);
  }
});

