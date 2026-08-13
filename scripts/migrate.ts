import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migration = await readFile(resolve("migrations/001_initial.sql"), "utf8");
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(migration);
  console.log("Applied migrations/001_initial.sql");
} finally {
  await pool.end();
}
