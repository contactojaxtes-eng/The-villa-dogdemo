const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./dev.db');

db.all("SELECT name FROM sqlite_master WHERE type='table';", [], (err, tables) => {
    if (err) {
        throw err;
    }
    console.log("Tables:");
    tables.forEach((row) => {
        console.log(row.name);
    });
});
db.close();
