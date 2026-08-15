import { z } from "zod";

import { assistantProfiles, type AssistantProfile } from "./profiles.js";

export const apiRoles = [
  "chat",
  "documents:read",
  "documents:write",
  "documents:global",
  "documents:tenants",
] as const;

export type ApiRole = (typeof apiRoles)[number];

export interface ApiClient {
  tenantId: string;
  key: string;
  roles: ApiRole[];
  allowedProfiles: AssistantProfile[];
  defaultProfile: AssistantProfile;
}

const apiClientSchema = z
  .object({
    tenantId: z.string().min(1),
    key: z.string().min(8),
    roles: z.array(z.enum(apiRoles)).min(1),
    allowedProfiles: z.array(z.enum(assistantProfiles)).min(1).default(["accounting_client"]),
    defaultProfile: z.enum(assistantProfiles).default("accounting_client"),
  })
  .refine((value) => value.allowedProfiles.includes(value.defaultProfile), {
    message: "defaultProfile must be included in allowedProfiles",
    path: ["defaultProfile"],
  });

export function parseApiClients(value: string): ApiClient[] {
  return z.array(apiClientSchema).parse(JSON.parse(value));
}

const rawConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TRUST_PROXY: z
      .string()
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z.string().default("info"),
    API_CLIENTS_JSON: z.string().default("[]"),
    AI_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-5.6-terra"),
    OPENAI_VECTOR_STORE_ID: z.string().optional(),
    OPENAI_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).default("low"),
    OPENAI_FILE_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(10),
    OPENAI_VECTOR_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2_000),
    OPENAI_VECTOR_POLL_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(300_000),
    INGESTION_WORKER_POLL_MS: z.coerce.number().int().min(100).default(1_000),
    INGESTION_LEASE_SECONDS: z.coerce.number().int().min(10).default(300),
    INGESTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    INGESTION_RETRY_BASE_MS: z.coerce.number().int().min(100).default(5_000),
    INGESTION_RETRY_MAX_MS: z.coerce.number().int().min(100).default(300_000),
    DATABASE_URL: z.string().optional(),
    CONVERSATION_ENCRYPTION_KEY: z.string().optional(),
    CONVERSATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
    DATA_DIR: z.string().default("./data"),
    MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1).max(512 * 1024 * 1024).default(25 * 1024 * 1024),
  })
  .superRefine((value, context) => {
    if (Boolean(value.DATABASE_URL) !== Boolean(value.CONVERSATION_ENCRYPTION_KEY)) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL and CONVERSATION_ENCRYPTION_KEY must be configured together",
      });
    }
    if (value.NODE_ENV === "production" && !value.DATABASE_URL) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL and persistent encrypted conversation storage are required in production",
      });
    }
    if (value.AI_PROVIDER === "openai" && (!value.OPENAI_API_KEY || !value.OPENAI_VECTOR_STORE_ID)) {
      context.addIssue({
        code: "custom",
        message: "OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required when AI_PROVIDER=openai",
      });
    }
    if (value.NODE_ENV === "production" && value.AI_PROVIDER !== "openai") {
      context.addIssue({
        code: "custom",
        message: "AI_PROVIDER=openai is required in production",
      });
    }
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  trustProxy: boolean;
  logLevel: string;
  apiClients: ApiClient[];
  aiProvider: "fake" | "openai";
  openAiApiKey?: string;
  openAiModel: string;
  openAiVectorStoreId?: string;
  openAiReasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  openAiFileSearchMaxResults: number;
  openAiVectorPollIntervalMs: number;
  openAiVectorPollTimeoutMs: number;
  ingestionWorkerPollMs: number;
  ingestionLeaseSeconds: number;
  ingestionMaxAttempts: number;
  ingestionRetryBaseMs: number;
  ingestionRetryMaxMs: number;
  databaseUrl?: string;
  conversationEncryptionKey?: Buffer;
  conversationRetentionDays: number;
  dataDir: string;
  maxDocumentBytes: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = rawConfigSchema.parse(environment);
  const apiClients = parseApiClients(raw.API_CLIENTS_JSON);

  let conversationEncryptionKey: Buffer | undefined;
  if (raw.CONVERSATION_ENCRYPTION_KEY) {
    conversationEncryptionKey = Buffer.from(raw.CONVERSATION_ENCRYPTION_KEY, "base64");
    if (conversationEncryptionKey.length !== 32) {
      throw new Error("CONVERSATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
  }

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL,
    apiClients,
    aiProvider: raw.AI_PROVIDER,
    ...(raw.OPENAI_API_KEY ? { openAiApiKey: raw.OPENAI_API_KEY } : {}),
    openAiModel: raw.OPENAI_MODEL,
    ...(raw.OPENAI_VECTOR_STORE_ID ? { openAiVectorStoreId: raw.OPENAI_VECTOR_STORE_ID } : {}),
    openAiReasoningEffort: raw.OPENAI_REASONING_EFFORT,
    openAiFileSearchMaxResults: raw.OPENAI_FILE_SEARCH_MAX_RESULTS,
    openAiVectorPollIntervalMs: raw.OPENAI_VECTOR_POLL_INTERVAL_MS,
    openAiVectorPollTimeoutMs: raw.OPENAI_VECTOR_POLL_TIMEOUT_MS,
    ingestionWorkerPollMs: raw.INGESTION_WORKER_POLL_MS,
    ingestionLeaseSeconds: raw.INGESTION_LEASE_SECONDS,
    ingestionMaxAttempts: raw.INGESTION_MAX_ATTEMPTS,
    ingestionRetryBaseMs: raw.INGESTION_RETRY_BASE_MS,
    ingestionRetryMaxMs: raw.INGESTION_RETRY_MAX_MS,
    ...(raw.DATABASE_URL ? { databaseUrl: raw.DATABASE_URL } : {}),
    ...(conversationEncryptionKey ? { conversationEncryptionKey } : {}),
    conversationRetentionDays: raw.CONVERSATION_RETENTION_DAYS,
    dataDir: raw.DATA_DIR,
    maxDocumentBytes: raw.MAX_DOCUMENT_BYTES,
  };
}
