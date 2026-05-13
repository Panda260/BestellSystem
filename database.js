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
        db.serialize(() => {
            // Menu Items table
            db.run(`CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                active INTEGER DEFAULT 1,
                max_limit INTEGER DEFAULT NULL,
                category TEXT DEFAULT NULL
            )`, (err) => {

                if (err) return reject(err);
                
                // Check if we need to seed
                db.get("SELECT COUNT(*) as count FROM menu_items", (err, row) => {
                    if (err) return reject(err);
                    if (row.count === 0) {
                        const initialItems = [
                            { name: "Pizza Margherita", price: 2.0 },
                            { name: "Pizza Mozzarella", price: 2.50 },
                            { name: "Brezel", price: 0.50 },
                            { name: "Spezi", price: 1.0 },
                            { name: "Cola", price: 1.0 },
                            { name: "Fanta", price: 1.0 },
                            { name: "Sprite", price: 1.0 },
                            { name: "Apfelschorle", price: 1.0 },
                            { name: "Wassereis", price: 0.20 },
                            { name: "Kinderriegel", price: 0.30 },
                            { name: "Schokobrötchen", price: 0.30 },
                            { name: "Haribo", price: 0.10 },
                            { name: "Knoppers", price: 0.30 }
                        ];
                        const stmt = db.prepare("INSERT INTO menu_items (name, price) VALUES (?, ?)");
                        initialItems.forEach(item => stmt.run(item.name, item.price));
                        stmt.finalize();
                    }
                });
            });

            // Orders table (for persistence)
            db.run(`CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                items TEXT NOT NULL,
                total REAL NOT NULL,
                customerName TEXT,
                createdAt TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                completedAt TEXT
            )`, (err) => {
                if (err) return reject(err);
                resolve();
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
        db.run("INSERT INTO orders (id, items, total, customerName, createdAt, completed) VALUES (?, ?, ?, ?, ?, ?)", 
            [order.id, JSON.stringify(order.items), order.total, order.customerName, order.createdAt, order.completed ? 1 : 0], 
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
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

const getAllOrders = (onlyOpen = true) => {
    return new Promise((resolve, reject) => {
        const query = onlyOpen ? "SELECT * FROM orders WHERE completed = 0" : "SELECT * FROM orders";
        db.all(query, (err, rows) => {
            if (err) reject(err);
            else {
                resolve(rows.map(row => ({
                    ...row,
                    items: JSON.parse(row.items),
                    completed: !!row.completed
                })));
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
                resolve({
                    ...row,
                    items: JSON.parse(row.items),
                    completed: !!row.completed
                });
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
                        stats[item.name] = (stats[item.name] || 0) + item.qty;
                    });
                });
                resolve(stats);
            }
        });
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
    getAllOrders,
    getOrderById,
    getOrderStats
};

