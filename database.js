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
            db.run(`CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                active INTEGER DEFAULT 1,
                max_limit INTEGER DEFAULT NULL,
                category TEXT DEFAULT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY,
                max_limit INTEGER
            )`, (err) => {
                if (err) return reject(err);
                
                // Seed Pizza category
                db.run("INSERT OR IGNORE INTO categories (name, max_limit) VALUES (?, ?)", ["Pizza", null]);
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
                        stats[item.name] = (stats[item.name] || 0) + 1; // qty is always 1 now
                    });
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

const resetStats = () => {

    return new Promise((resolve, reject) => {
        db.run("DELETE FROM orders", (err) => {
            if (err) reject(err);
            else resolve();
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
    getOrderStats,
    getCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    resetStats
};



