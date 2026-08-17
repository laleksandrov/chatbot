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
  for (const expected of [
    "001_initial.sql",
    "002_document_ingestion_queue.sql",
    "003_assistant_profiles_and_quotas.sql",
    "004_public_platform_documents.sql",
    "005_access_management.sql",
    "006_environment_admin.sql",
    "007_two_easy_start_profiles.sql",
    "008_refresh_easy_start_public_metadata.sql",
  ]) {
    if (!migrations.includes(expected)) throw new Error(`Missing database migration: ${expected}`);
  }

  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'documents'`,
  );
  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  for (const expected of [
    "lease_until",
    "openai_file_id",
    "vector_store_file_id",
    "indexed_at",
    "organization_id",
  ]) {
    if (!columnNames.has(expected)) throw new Error(`Missing documents column: ${expected}`);
  }
  const conversationColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'conversations'`,
  );
  const conversationColumnNames = new Set(conversationColumns.rows.map((row) => row.column_name));
  for (const expected of ["assistant_profile", "external_organization_hash"]) {
    if (!conversationColumnNames.has(expected)) throw new Error(`Missing conversations column: ${expected}`);
  }
  const profileTables = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'chat_quota_windows'`,
  );
  if (profileTables.rowCount !== 1) throw new Error("Missing chat_quota_windows table");
  const accessTables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [["users", "api_clients", "admin_sessions"]],
  );
  if (accessTables.rowCount !== 3) throw new Error("Missing access-management tables");
  const adminSessionColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admin_sessions' AND column_name = 'admin_email'`,
  );
  if (adminSessionColumns.rowCount !== 1) throw new Error("Missing admin_sessions.admin_email column");
  console.log(`PostgreSQL ready; migrations: ${migrations.join(", ")}`);
} finally {
  await pool.end();
}

const openai = new OpenAI({ apiKey: openAiApiKey });
const vectorStore = await openai.vectorStores.retrieve(vectorStoreId);
const counts = vectorStore.file_counts;
if (vectorStore.status === "expired") {
  throw new Error(`OpenAI vector store has expired: ${vectorStore.id}`);
}
if (vectorStore.status === "in_progress" && counts.completed === 0) {
  throw new Error(
    `OpenAI vector store has no completed files yet: ${counts.in_progress} in progress, ${counts.failed} failed`,
  );
}
if (vectorStore.status === "in_progress") {
  console.warn(
    `OpenAI vector store reachable; indexing continues: ${counts.completed} completed, ${counts.in_progress} in progress, ${counts.failed} failed`,
  );
} else {
  console.log(`OpenAI vector store ready: ${vectorStore.id} (${vectorStore.status})`);
}
if (counts.failed > 0) {
  console.warn(`OpenAI vector store contains ${counts.failed} failed file(s); inspect the ingestion queue.`);
}
