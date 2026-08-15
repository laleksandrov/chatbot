import { resolve } from "node:path";

import {
  FallbackApiClientAuthenticator,
  PostgresAccessRepository,
  StaticApiClientAuthenticator,
} from "./access.js";
import {
  InMemoryConversationStore,
  PostgresConversationStore,
  createPostgresPool,
} from "./conversations.js";
import { createApp } from "./app.js";
import { FakeChatProvider } from "./chat.js";
import { loadConfig } from "./config.js";
import {
  InMemoryDocumentRepository,
  LocalRawDocumentStorage,
  PendingDocumentProcessor,
  PostgresDocumentRepository,
} from "./documents.js";
import { OpenAIChatProvider } from "./openai-provider.js";
import { InMemoryChatQuotaStore, PostgresChatQuotaStore } from "./quotas.js";

const config = loadConfig();
const pool = config.databaseUrl ? createPostgresPool(config.databaseUrl) : undefined;
const staticAuthenticator = new StaticApiClientAuthenticator(config.apiClients);
const accessRepository = pool
  ? new PostgresAccessRepository(
      pool,
      config.adminEmail && config.adminPassword
        ? { email: config.adminEmail, password: config.adminPassword }
        : undefined,
    )
  : undefined;
const apiClientAuthenticator = accessRepository
  ? new FallbackApiClientAuthenticator(accessRepository, staticAuthenticator)
  : staticAuthenticator;

const conversationStore =
  pool && config.conversationEncryptionKey
    ? new PostgresConversationStore(pool, config.conversationEncryptionKey, config.conversationRetentionDays)
    : new InMemoryConversationStore();

const documentRepository = pool
  ? new PostgresDocumentRepository(pool)
  : new InMemoryDocumentRepository();

const chatQuotaStore =
  pool && config.conversationEncryptionKey
    ? new PostgresChatQuotaStore(pool, config.conversationEncryptionKey)
    : new InMemoryChatQuotaStore();

const chatProvider =
  config.aiProvider === "openai" && config.openAiApiKey && config.openAiVectorStoreId
    ? new OpenAIChatProvider({
        apiKey: config.openAiApiKey,
        model: config.openAiModel,
        vectorStoreId: config.openAiVectorStoreId,
        reasoningEffort: config.openAiReasoningEffort,
        maxResults: config.openAiFileSearchMaxResults,
      })
    : new FakeChatProvider();

const app = await createApp({
  config,
  chatProvider,
  conversationStore,
  chatQuotaStore,
  documentRepository,
  rawDocumentStorage: new LocalRawDocumentStorage(resolve(config.dataDir)),
  documentProcessor: new PendingDocumentProcessor(),
  apiClientAuthenticator,
  ...(accessRepository ? { adminRepository: accessRepository } : {}),
  ...(pool ? { readinessCheck: async () => { await pool.query("SELECT 1"); } } : {}),
});

if (!pool) {
  app.log.warn("DATABASE_URL is not configured; metadata and conversations are in memory");
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Stopping server");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
