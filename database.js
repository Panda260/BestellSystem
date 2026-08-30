const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'bestellsystem.db');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

const db = new sqlite3.Database(dbPath);

const initDb = () => {
    return new Promise((resolve, reject) => {
        db.run("PRAGMA journal_mode = WAL;");
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                active INTEGER DEFAULT 1,
                max_limit INTEGER DEFAULT NULL,
                category TEXT DEFAULT NULL
            )`, () => {
                // Migration: add columns if they don't exist (for existing DBs)
                db.all("PRAGMA table_info(menu_items)", (err, columns) => {
                    if (!err && columns) {
                        const hasMaxLimit = columns.some(c => c.name === 'max_limit');
                        const hasCategory = columns.some(c => c.name === 'category');
                        if (!hasMaxLimit) db.run("ALTER TABLE menu_items ADD COLUMN max_limit INTEGER DEFAULT NULL");
                        if (!hasCategory) db.run("ALTER TABLE menu_items ADD COLUMN category TEXT DEFAULT NULL");
                    }
                });
            });


            db.run(`CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY,
                max_limit INTEGER
            )`, (err) => {
                if (err) return reject(err);
                
                // Seed Pizza category
                db.run("INSERT OR IGNORE INTO categories (name, max_limit) VALUES (?, ?)", ["Pizza", null]);
            });

            // Customer names table (for autocomplete)
            db.run(`CREATE TABLE IF NOT EXISTS customer_names (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                createdAt TEXT NOT NULL
            )`);

            // TV settings table (key-value)
            db.run(`CREATE TABLE IF NOT EXISTS tv_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )`);

            // Orders table (for persistence)
            db.run(`CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                items TEXT NOT NULL,
                total REAL NOT NULL,
                customerName TEXT,
                createdAt TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                completedAt TEXT,
                pickedUp INTEGER DEFAULT 0,
                pickedUpAt TEXT,
                historyCleared INTEGER DEFAULT 0
            )`, (err) => {
                if (err) return reject(err);
                
                // Migration: add inOven, pickedUp, pickedUpAt columns if they don't exist
                db.all("PRAGMA table_info(orders)", (err, columns) => {
                    const nextStep = () => {
                        // Create lifetime_stats table and resolve/reject
                        db.run(`CREATE TABLE IF NOT EXISTS lifetime_stats (
                            item_name TEXT PRIMARY KEY,
                            qty INTEGER DEFAULT 0
                        )`, (err2) => {
                            if (err2) return reject(err2);
                            
                            // If lifetime_stats is empty, populate from orders
                            db.get("SELECT COUNT(*) as count FROM lifetime_stats", (err3, row) => {
                                if (!err3 && row && row.count === 0) {
                                    db.all("SELECT items FROM orders", (err4, orderRows) => {
                                        if (!err4 && orderRows && orderRows.length > 0) {
                                            const initialCounts = {};
                                            orderRows.forEach(or => {
                                                try {
                                                    const items = JSON.parse(or.items);
                                                    items.forEach(item => {
                                                        initialCounts[item.name] = (initialCounts[item.name] || 0) + 1;
                                                    });
                                                } catch (e) {}
                                            });
                                            db.serialize(() => {
                                                const stmt = db.prepare("INSERT INTO lifetime_stats (item_name, qty) VALUES (?, ?)");
                                                Object.entries(initialCounts).forEach(([name, qty]) => {
                                                    stmt.run(name, qty);
                                                });
                                                stmt.finalize((err5) => {
                                                    if (err5) reject(err5);
                                                    else resolve();
                                                });
                                            });
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    resolve();
                                }
                            });
                        });
                    };

                    if (!err && columns) {
                        const hasInOven = columns.some(c => c.name === 'inOven');
                        const hasPickedUp = columns.some(c => c.name === 'pickedUp');
                        const hasPickedUpAt = columns.some(c => c.name === 'pickedUpAt');
                        const hasHistoryCleared = columns.some(c => c.name === 'historyCleared');
                        
                        db.serialize(() => {
                            if (!hasInOven) db.run("ALTER TABLE orders ADD COLUMN inOven INTEGER DEFAULT 0");
                            if (!hasPickedUp) db.run("ALTER TABLE orders ADD COLUMN pickedUp INTEGER DEFAULT 0");
                            if (!hasPickedUpAt) db.run("ALTER TABLE orders ADD COLUMN pickedUpAt TEXT");
                            if (!hasHistoryCleared) db.run("ALTER TABLE orders ADD COLUMN historyCleared INTEGER DEFAULT 0");
                        });
                        // Allow migrations to finish
                        setTimeout(nextStep, 100);
                    } else {
                        nextStep();
                    }
                });
            });
        });
    });
};


const getMenuItems = (onlyActive = true) => {
    return new Promise((resolve, reject) => {
        const query = onlyActive ? "SELECT * FROM menu_items WHERE active = 1" : "SELECT * FROM menu_items";
        db.all(query, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const addMenuItem = (name, price) => {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO menu_items (name, price) VALUES (?, ?)", [name, price], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
};

const updateMenuItem = (id, name, price, active, max_limit, category) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE menu_items SET name = ?, price = ?, active = ?, max_limit = ?, category = ? WHERE id = ?", 
            [name, price, active ? 1 : 0, max_limit, category, id], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};


const deleteMenuItem = (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM menu_items WHERE id = ?", [id], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
};

const saveOrder = (order) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("INSERT INTO orders (id, items, total, customerName, createdAt, completed, inOven, pickedUp, pickedUpAt, historyCleared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                [order.id, JSON.stringify(order.items), order.total, order.customerName, order.createdAt, order.completed ? 1 : 0, order.inOven ? 1 : 0, order.pickedUp ? 1 : 0, order.pickedUpAt || null, 0], 
                function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Increment lifetime counts
                    const stmt = db.prepare(`
                        INSERT INTO lifetime_stats (item_name, qty) VALUES (?, 1)
                        ON CONFLICT(item_name) DO UPDATE SET qty = qty + 1
                    `);
                    order.items.forEach(item => {
                        stmt.run(item.name);
                    });
                    stmt.finalize((err2) => {
                        if (err2) reject(err2);
                        else resolve();
                    });
                }
            );
        });
    });
};

const updateOrderCompleted = (id, completed, completedAt) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE orders SET completed = ?, completedAt = ?, items = (SELECT items FROM orders WHERE id = ?) WHERE id = ?", 
            [completed ? 1 : 0, completedAt, id, id], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

// We also need to update order items (the "done" status)
const updateOrderItems = (id, items, completed, completedAt) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE orders SET items = ?, completed = ?, completedAt = ? WHERE id = ?", 
            [JSON.stringify(items), completed ? 1 : 0, completedAt, id], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

const updateOrderOven = (id, inOven) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE orders SET inOven = ? WHERE id = ?", 
            [inOven ? 1 : 0, id], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

const updateOrderPickedUp = (id, pickedUp, pickedUpAt) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE orders SET pickedUp = ?, pickedUpAt = ? WHERE id = ?", 
            [pickedUp ? 1 : 0, pickedUpAt, id], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

const getAllOrders = (onlyOpen = true) => {
    return new Promise((resolve, reject) => {
        // If onlyOpen is true, we want orders that are NOT picked up yet
        // Originally it was "completed = 0", but now staff needs to see completed ones too
        // We'll change onlyOpen to mean "not picked up". If they want truly ALL orders, onlyOpen = false.
        const query = onlyOpen ? "SELECT * FROM orders WHERE pickedUp = 0 ORDER BY createdAt ASC" : "SELECT * FROM orders ORDER BY createdAt ASC";
        db.all(query, (err, rows) => {
            if (err) reject(err);
            else {
                resolve(rows.map(row => {
                    let items = [];
                    try {
                        items = JSON.parse(row.items).map((item) => ({
                            ...item,
                            done: !!item.done,
                            inOven: !!item.inOven,
                            pickedUp: !!item.pickedUp,
                        }));
                    } catch (e) {}
                    return {
                        ...row,
                        items,
                        completed: !!row.completed,
                        inOven: !!row.inOven,
                        pickedUp: !!row.pickedUp
                    };
                }));
            }
        });
    });
};

const getOrderById = (id) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM orders WHERE id = ?", [id], (err, row) => {
            if (err) reject(err);
            else if (!row) resolve(null);
            else {
                let items = [];
                try {
                    items = JSON.parse(row.items).map((item) => ({
                        ...item,
                        done: !!item.done,
                        inOven: !!item.inOven,
                        pickedUp: !!item.pickedUp,
                    }));
                } catch (e) {}
                resolve({
                    ...row,
                    items,
                    completed: !!row.completed,
                    inOven: !!row.inOven,
                    pickedUp: !!row.pickedUp
                });
            }
        });
    });
};

const getPickedUpOrders = (date = null) => {
    return new Promise((resolve, reject) => {
        let query = "SELECT * FROM orders WHERE pickedUp = 1 AND historyCleared = 0";
        let params = [];
        if (date) {
            query += " AND pickedUpAt LIKE ?";
            params.push(`${date}%`);
        }
        query += " ORDER BY pickedUpAt DESC";
        
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else {
                resolve(rows.map(row => {
                    let items = [];
                    try {
                        items = JSON.parse(row.items).map((item) => ({
                            ...item,
                            done: !!item.done,
                            inOven: !!item.inOven,
                            pickedUp: !!item.pickedUp,
                        }));
                    } catch (e) {}
                    return {
                        ...row,
                        items,
                        completed: !!row.completed,
                        inOven: !!row.inOven,
                        pickedUp: !!row.pickedUp
                    };
                }));
            }
        });
    });
};

const getOrderStats = (date = null) => {
    return new Promise((resolve, reject) => {
        let query = "SELECT items, createdAt FROM orders";
        let params = [];
        if (date) {
            query += " WHERE createdAt LIKE ?";
            params.push(`${date}%`);
        }
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else {
                const stats = {};
                rows.forEach(row => {
                    const items = JSON.parse(row.items);
                    items.forEach(item => {
                        stats[item.name] = (stats[item.name] || 0) + 1; // qty is always 1 now
                    });
                });
                resolve(stats);
            }
        });
    });
};

const getCustomerStats = (date = null) => {
    return new Promise((resolve, reject) => {
        let query = "SELECT items, customerName, createdAt FROM orders";
        let params = [];
        if (date) {
            query += " WHERE createdAt LIKE ?";
            params.push(`${date}%`);
        }
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else {
                const stats = {};
                rows.forEach(row => {
                    const name = row.customerName || "Unbekannt";
                    if (!stats[name]) stats[name] = { qty: 0, total: 0 };
                    try {
                        const items = JSON.parse(row.items);
                        items.forEach(item => {
                            stats[name].qty += 1;
                            stats[name].total += (item.price || 0);
                        });
                    } catch (e) {}
                });
                resolve(stats);
            }
        });
    });
};

const getCategories = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM categories", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const addCategory = (name, max_limit) => {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO categories (name, max_limit) VALUES (?, ?)", [name, max_limit], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
};

const updateCategory = (name, max_limit) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE categories SET max_limit = ? WHERE name = ?", [max_limit, name], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
};

const deleteCategory = (name) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM categories WHERE name = ?", [name], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
};

// ---- Customer names (autocomplete) ----
const getCustomerNames = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, name, createdAt FROM customer_names ORDER BY name COLLATE NOCASE ASC", (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
};

const searchCustomerNames = (query) => {
    return new Promise((resolve, reject) => {
        const q = `%${query}%`;
        db.all(
            "SELECT id, name FROM customer_names WHERE name LIKE ? COLLATE NOCASE ORDER BY name COLLATE NOCASE ASC LIMIT 20",
            [q],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
};

const addCustomerName = (name) => {
    return new Promise((resolve, reject) => {
        const clean = (name || "").trim();
        if (!clean) return resolve(null);
        db.run(
            "INSERT OR IGNORE INTO customer_names (name, createdAt) VALUES (?, ?)",
            [clean, new Date().toISOString()],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID || null);
            }
        );
    });
};

// Backfill customer_names from orders (with case-insensitive duplicate check)
const backfillCustomerNames = () => {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT DISTINCT customerName FROM orders WHERE customerName IS NOT NULL AND TRIM(customerName) != ''",
            (err, rows) => {
                if (err) return reject(err);
                const orderNames = (rows || [])
                    .map(r => r.customerName.trim())
                    .filter(Boolean);
                db.all("SELECT name FROM customer_names", (err2, existing) => {
                    if (err2) return reject(err2);
                    const existingLower = new Set((existing || []).map(r => r.name.toLowerCase()));
                    const toAdd = orderNames.filter(n => !existingLower.has(n.toLowerCase()));
                    const total = orderNames.length;
                    if (toAdd.length === 0) {
                        return resolve({ total, added: 0, skipped: total });
                    }
                    let added = 0;
                    let pending = toAdd.length;
                    toAdd.forEach(name => {
                        db.run(
                            "INSERT OR IGNORE INTO customer_names (name, createdAt) VALUES (?, ?)",
                            [name, new Date().toISOString()],
                            function(e) {
                                if (e) console.error("Backfill insert error:", e);
                                else if (this.lastID) added += 1;
                                pending -= 1;
                                if (pending === 0) {
                                    resolve({ total, added, skipped: total - added });
                                }
                            }
                        );
                    });
                });
            }
        );
    });
};

const updateCustomerName = (id, name) => {
    return new Promise((resolve, reject) => {
        const clean = (name || "").trim();
        if (!clean) return reject(new Error("Name darf nicht leer sein"));
        db.run(
            "UPDATE customer_names SET name = ? WHERE id = ?",
            [clean, id],
            function(err) {
                if (err) reject(err);
                else if (this.changes === 0) reject(new Error("Nicht gefunden"));
                else resolve();
            }
        );
    });
};

const deleteCustomerName = (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM customer_names WHERE id = ?", [id], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
};

const getLifetimeStats = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT item_name, qty FROM lifetime_stats", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const stats = {};
                rows.forEach(row => {
                    stats[row.item_name] = row.qty;
                });
                resolve(stats);
            }
        });
    });
};

const resetStats = () => {

    return new Promise((resolve, reject) => {
        db.run("DELETE FROM orders", (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const clearHistory = () => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE orders SET historyCleared = 1 WHERE pickedUp = 1", (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// ---- TV Settings ----
const getTvSettings = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT key, value FROM tv_settings", (err, rows) => {
            if (err) return reject(err);
            const settings = {};
            (rows || []).forEach((r) => { settings[r.key] = r.value; });
            resolve(settings);
        });
    });
};

const setTvSetting = (key, value) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO tv_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, String(value)],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

module.exports = {
    initDb,
    getMenuItems,
    addMenuItem,
    updateMenuItem,
    deleteMenuItem,
    saveOrder,
    updateOrderCompleted,
    updateOrderItems,
    updateOrderOven,
    updateOrderPickedUp,
    getAllOrders,
    getOrderById,
    getPickedUpOrders,
    getOrderStats,
    getCustomerStats,
    getLifetimeStats,
    getCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    getCustomerNames,
    searchCustomerNames,
    addCustomerName,
    backfillCustomerNames,
    updateCustomerName,
    deleteCustomerName,
    resetStats,
    clearHistory,
    getTvSettings,
    setTvSetting
};



