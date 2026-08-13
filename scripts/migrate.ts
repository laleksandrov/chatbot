import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: databaseUrl });
const migrationsDirectory = resolve("migrations");

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('chatbot_schema_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();
    const applied = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const appliedFilenames = new Set(applied.rows.map((row) => row.filename));

    for (const filename of filenames) {
      if (appliedFilenames.has(filename)) continue;
      const migration = await readFile(resolve(migrationsDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(migration);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.log(`Applied migrations/${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('chatbot_schema_migrations'))");
    client.release();
  }
} finally {
  await pool.end();
}
