import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessAdminRepository, AdminSession } from "../src/access.js";
import { createApp } from "../src/app.js";
import { FakeChatProvider } from "../src/chat.js";
import type { AppConfig } from "../src/config.js";
import { InMemoryConversationStore } from "../src/conversations.js";
import { InMemoryDocumentRepository, LocalRawDocumentStorage, PendingDocumentProcessor } from "../src/documents.js";
import { InMemoryChatQuotaStore } from "../src/quotas.js";

describe("admin access management", () => {
  let dataDir: string;

  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "chatbot-admin-test-")); });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  async function buildApp() {
    const session: AdminSession = {
      user: { id: "admin-1", email: "admin@example.com", isAdmin: true, active: true, lastLoginAt: null, createdAt: new Date() },
      csrfToken: "csrf-test-token",
    };
    const repository: AccessAdminRepository = {
      authenticateApiKey: vi.fn(async () => null),
      listApiClients: vi.fn(async () => []),
      createApiClient: vi.fn(async (input) => ({ client: { id: "client-1", ...input, keyPrefix: "cb_example", active: true, lastUsedAt: null, createdAt: new Date() }, key: "cb_generated_secret" })),
      setApiClientActive: vi.fn(async () => true),
      updateApiClientAccess: vi.fn(async () => true),
      importApiClient: vi.fn(async () => undefined),
      listUsers: vi.fn(async () => [session.user]),
      createUser: vi.fn(async (input) => ({ id: "user-2", email: input.email, isAdmin: input.isAdmin, active: true, lastLoginAt: null, createdAt: new Date() })),
      setUserAccess: vi.fn(async () => true),
      createSession: vi.fn(async (email, password) => email === "admin@example.com" && password === "long-test-password" ? { token: "session-token", session } : null),
      findSession: vi.fn(async (token) => token === "session-token" ? session : null),
      deleteSession: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const config: AppConfig = {
      nodeEnv: "test", host: "127.0.0.1", port: 3000, trustProxy: false, logLevel: "silent", apiClients: [],
      aiProvider: "fake", openAiModel: "gpt-5.6-terra", openAiReasoningEffort: "low", openAiFileSearchMaxResults: 10,
      openAiVectorPollIntervalMs: 2000, openAiVectorPollTimeoutMs: 300000, ingestionWorkerPollMs: 1000,
      ingestionLeaseSeconds: 300, ingestionMaxAttempts: 5, ingestionRetryBaseMs: 5000, ingestionRetryMaxMs: 300000,
      conversationRetentionDays: 180, dataDir, maxDocumentBytes: 1024 * 1024,
    };
    const app = await createApp({ config, adminRepository: repository, apiClientAuthenticator: repository, chatProvider: new FakeChatProvider(), conversationStore: new InMemoryConversationStore(), chatQuotaStore: new InMemoryChatQuotaStore(), documentRepository: new InMemoryDocumentRepository(), rawDocumentStorage: new LocalRawDocumentStorage(dataDir), documentProcessor: new PendingDocumentProcessor() });
    return { app, repository };
  }

  it("requires login and creates a key that is shown once", async () => {
    const { app, repository } = await buildApp();
    const denied = await app.inject({ method: "GET", url: "/admin" });
    expect(denied.statusCode).toBe(302);
    expect(denied.headers.location).toBe("/admin/login");

    const login = await app.inject({ method: "POST", url: "/admin/login", payload: { email: "admin@example.com", password: "long-test-password" } });
    expect(login.statusCode).toBe(302);
    const setCookie = login.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const create = await app.inject({ method: "POST", url: "/admin/api-clients", headers: { cookie }, payload: { csrf: "csrf-test-token", name: "EasyStart public", tenantId: "easystart", roles: "chat", profiles: "public_pre_registration", defaultProfile: "public_pre_registration" } });
    expect(create.statusCode).toBe(200);
    expect(create.body).toContain("cb_generated_secret");
    expect(repository.createApiClient).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "easystart", roles: ["chat"] }));

    const update = await app.inject({ method: "POST", url: "/admin/api-clients/client-1/access", headers: { cookie }, payload: { csrf: "csrf-test-token", roles: ["chat", "documents:read"], profiles: "registered_customer", defaultProfile: "registered_customer" } });
    expect(update.statusCode).toBe(302);
    expect(repository.updateApiClientAccess).toHaveBeenCalledWith("client-1", expect.objectContaining({ roles: ["chat", "documents:read"] }));
    await app.close();
  });
});
