import OpenAI from "openai";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const openAiApiKey = process.env.OPENAI_API_KEY;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

if (!databaseUrl || !openAiApiKey || !vectorStoreId) {
  throw new Error("DATABASE_URL, OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required");
}

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
try {
  const migrationResult = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  const migrations = migrationResult.rows.map((row) => row.filename);
  for (const expected of ["001_initial.sql", "002_document_ingestion_queue.sql"]) {
    if (!migrations.includes(expected)) throw new Error(`Missing database migration: ${expected}`);
  }

  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'documents'`,
  );
  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  for (const expected of ["lease_until", "openai_file_id", "vector_store_file_id", "indexed_at"]) {
    if (!columnNames.has(expected)) throw new Error(`Missing documents column: ${expected}`);
  }
  console.log(`PostgreSQL ready; migrations: ${migrations.join(", ")}`);
} finally {
  await pool.end();
}

const openai = new OpenAI({ apiKey: openAiApiKey });
const vectorStore = await openai.vectorStores.retrieve(vectorStoreId);
if (vectorStore.status !== "completed") {
  throw new Error(`OpenAI vector store is not ready: ${vectorStore.status}`);
}
console.log(`OpenAI vector store ready: ${vectorStore.id} (${vectorStore.status})`);
