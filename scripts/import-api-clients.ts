import { Pool } from "pg";

import { PostgresAccessRepository } from "../src/access.js";
import { parseApiClients } from "../src/config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const clients = parseApiClients(process.env.API_CLIENTS_JSON ?? "[]");
if (!clients.length) throw new Error("API_CLIENTS_JSON contains no clients");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const repository = new PostgresAccessRepository(pool);
  for (const [index, client] of clients.entries()) {
    const name = `${client.tenantId} (import ${index + 1})`;
    await repository.importApiClient(name, client);
    console.log(`Imported ${name}: ${client.key.slice(0, 10)}…`);
  }
} finally {
  await pool.end();
}
