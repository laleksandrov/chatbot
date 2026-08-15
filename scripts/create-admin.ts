import { Pool } from "pg";

import { PostgresAccessRepository } from "../src/access.js";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!email) throw new Error("ADMIN_EMAIL is required");
if (!password) throw new Error("ADMIN_PASSWORD is required (minimum 12 characters)");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const repository = new PostgresAccessRepository(pool);
  const user = await repository.createUser({ email, password, isAdmin: true });
  console.log(`Created administrator: ${user.email}`);
} finally {
  await pool.end();
}
