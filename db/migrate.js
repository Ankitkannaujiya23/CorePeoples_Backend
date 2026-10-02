// Applies db/schema.sql against the configured MySQL server.
// Run with: npm run db:migrate

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  try {
    await connection.query(sql);
    // eslint-disable-next-line no-console
    console.log("✓ Schema applied to database:", process.env.DB_NAME || "votedesk");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

migrate();
