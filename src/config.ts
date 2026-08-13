import { z } from "zod";

export const apiRoles = [
  "chat",
  "documents:read",
  "documents:write",
  "documents:global",
] as const;

export type ApiRole = (typeof apiRoles)[number];

export interface ApiClient {
  tenantId: string;
  key: string;
  roles: ApiRole[];
}

const apiClientSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(8),
  roles: z.array(z.enum(apiRoles)).min(1),
});

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
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-5.6-terra"),
    OPENAI_VECTOR_STORE_ID: z.string().optional(),
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
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  trustProxy: boolean;
  logLevel: string;
  apiClients: ApiClient[];
  openAiApiKey?: string;
  openAiModel: string;
  openAiVectorStoreId?: string;
  databaseUrl?: string;
  conversationEncryptionKey?: Buffer;
  conversationRetentionDays: number;
  dataDir: string;
  maxDocumentBytes: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = rawConfigSchema.parse(environment);
  const apiClients = z.array(apiClientSchema).parse(JSON.parse(raw.API_CLIENTS_JSON));

  if (raw.NODE_ENV === "production" && apiClients.length === 0) {
    throw new Error("At least one API client is required in production");
  }

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
    ...(raw.OPENAI_API_KEY ? { openAiApiKey: raw.OPENAI_API_KEY } : {}),
    openAiModel: raw.OPENAI_MODEL,
    ...(raw.OPENAI_VECTOR_STORE_ID ? { openAiVectorStoreId: raw.OPENAI_VECTOR_STORE_ID } : {}),
    ...(raw.DATABASE_URL ? { databaseUrl: raw.DATABASE_URL } : {}),
    ...(conversationEncryptionKey ? { conversationEncryptionKey } : {}),
    conversationRetentionDays: raw.CONVERSATION_RETENTION_DAYS,
    dataDir: raw.DATA_DIR,
    maxDocumentBytes: raw.MAX_DOCUMENT_BYTES,
  };
}
