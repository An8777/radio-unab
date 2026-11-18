/**
 * db.js — Conexión a MySQL y setup de tabla locutores
 */
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host:     process.env.MYSQLHOST     || process.env.DB_HOST     || "localhost",
  port:     process.env.MYSQLPORT     || process.env.DB_PORT     || 3306,
  user:     process.env.MYSQLUSER     || process.env.DB_USER     || "root",
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || "railway",
  waitForConnections: true,
  connectionLimit: 10
});

async function inicializarDB() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS locutores (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        usuario    VARCHAR(50)  NOT NULL UNIQUE,
        nombre     VARCHAR(100) NOT NULL,
        password   VARCHAR(255) NOT NULL,
        creado_en  DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("[DB] Tabla locutores lista");
  } catch (err) {
    console.error("[DB] Error al inicializar:", err.message);
  }
}

module.exports = { pool, inicializarDB };
