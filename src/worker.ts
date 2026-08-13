import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { createPostgresPool } from "./conversations.js";
import { loadConfig } from "./config.js";
import { LocalRawDocumentStorage, PostgresDocumentRepository } from "./documents.js";
import { DocumentIngestionWorker } from "./ingestion-worker.js";
import { OpenAIDocumentIndexer } from "./openai-indexer.js";

const config = loadConfig();
if (!config.databaseUrl || !config.openAiApiKey || !config.openAiVectorStoreId) {
  throw new Error("DATABASE_URL, OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required for the worker");
}

const pool = createPostgresPool(config.databaseUrl);
const abortController = new AbortController();
const worker = new DocumentIngestionWorker({
  repository: new PostgresDocumentRepository(pool),
  rawStorage: new LocalRawDocumentStorage(resolve(config.dataDir)),
  indexer: new OpenAIDocumentIndexer({
    apiKey: config.openAiApiKey,
    vectorStoreId: config.openAiVectorStoreId,
    pollIntervalMs: config.openAiVectorPollIntervalMs,
    pollTimeoutMs: config.openAiVectorPollTimeoutMs,
  }),
  workerId: `${process.pid}-${randomUUID()}`,
  pollMs: config.ingestionWorkerPollMs,
  leaseSeconds: config.ingestionLeaseSeconds,
  maxAttempts: config.ingestionMaxAttempts,
  retryBaseMs: config.ingestionRetryBaseMs,
  retryMaxMs: config.ingestionRetryMaxMs,
  log: (level, message, details) => console[level](message, details ?? {}),
});

process.on("SIGINT", () => abortController.abort());
process.on("SIGTERM", () => abortController.abort());

try {
  await worker.run(abortController.signal);
} finally {
  await pool.end();
}
