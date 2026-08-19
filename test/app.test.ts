import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { FakeChatProvider } from "../src/chat.js";
import type { AppConfig } from "../src/config.js";
import { InMemoryConversationStore } from "../src/conversations.js";
import { ChatProviderUnavailableError, type ChatProvider } from "../src/domain.js";
import {
  InMemoryDocumentRepository,
  LocalRawDocumentStorage,
  PendingDocumentProcessor,
} from "../src/documents.js";
import { InMemoryChatQuotaStore } from "../src/quotas.js";

const apiKey = "ems-test-key";
const knowledgeAdminKey = "knowledge-admin-test-key";

function multipartPayload(metadata: unknown, fileContent: string): { body: Buffer; contentType: string } {
  const boundary = "----chatbot-test-boundary";
  const chunks = [
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.txt"\r\nContent-Type: text/plain\r\n\r\n${fileContent}\r\n`,
    `--${boundary}--\r\n`,
  ];
  return {
    body: Buffer.from(chunks.join(""), "utf8"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("chatbot API", () => {
  let dataDir: string;
  let conversations: InMemoryConversationStore;
  let documents: InMemoryDocumentRepository;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "chatbot-test-"));
    conversations = new InMemoryConversationStore();
    documents = new InMemoryDocumentRepository();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function buildApp(
    chatProvider: ChatProvider = new FakeChatProvider(),
    allowedProfiles: AppConfig["apiClients"][number]["allowedProfiles"] = [
      "public_pre_registration",
      "registered_customer",
    ],
  ) {
    const config: AppConfig = {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 3000,
      trustProxy: false,
      logLevel: "silent",
      apiClients: [
        {
          tenantId: "ems",
          key: apiKey,
          roles: ["chat", "documents:read", "documents:write", "documents:global"],
          allowedProfiles,
          defaultProfile: "registered_customer",
        },
        {
          tenantId: "knowledge-admin",
          key: knowledgeAdminKey,
          roles: ["documents:read", "documents:write", "documents:global", "documents:tenants"],
          allowedProfiles: ["registered_customer"],
          defaultProfile: "registered_customer",
        },
      ],
      aiProvider: "fake",
      openAiModel: "gpt-5.6-terra",
      openAiReasoningEffort: "low",
      openAiFileSearchMaxResults: 10,
      openAiVectorPollIntervalMs: 2_000,
      openAiVectorPollTimeoutMs: 300_000,
      ingestionWorkerPollMs: 1_000,
      ingestionLeaseSeconds: 300,
      ingestionMaxAttempts: 5,
      ingestionRetryBaseMs: 5_000,
      ingestionRetryMaxMs: 300_000,
      conversationRetentionDays: 180,
      dataDir,
      maxDocumentBytes: 1024 * 1024,
    };

    return createApp({
      config,
      chatProvider,
      conversationStore: conversations,
      chatQuotaStore: new InMemoryChatQuotaStore(),
      documentRepository: documents,
      rawDocumentStorage: new LocalRawDocumentStorage(dataDir),
      documentProcessor: new PendingDocumentProcessor(),
    });
  }

  it("reports health without authentication", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("reports a failed dependency readiness check", async () => {
    const failingApp = await createApp({
      config: {
        nodeEnv: "test",
        host: "127.0.0.1",
        port: 3000,
        trustProxy: false,
        logLevel: "silent",
        apiClients: [],
        aiProvider: "fake",
        openAiModel: "gpt-5.6-terra",
        openAiReasoningEffort: "low",
        openAiFileSearchMaxResults: 10,
        openAiVectorPollIntervalMs: 2_000,
        openAiVectorPollTimeoutMs: 300_000,
        ingestionWorkerPollMs: 1_000,
        ingestionLeaseSeconds: 300,
        ingestionMaxAttempts: 5,
        ingestionRetryBaseMs: 5_000,
        ingestionRetryMaxMs: 300_000,
        conversationRetentionDays: 180,
        dataDir,
        maxDocumentBytes: 1024,
      },
      chatProvider: new FakeChatProvider(),
      conversationStore: new InMemoryConversationStore(),
      chatQuotaStore: new InMemoryChatQuotaStore(),
      documentRepository: new InMemoryDocumentRepository(),
      rawDocumentStorage: new LocalRawDocumentStorage(dataDir),
      documentProcessor: new PendingDocumentProcessor(),
      readinessCheck: async () => {
        throw new Error("database unavailable");
      },
    });
    const response = await failingApp.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not_ready" });
    await failingApp.close();
  });

  it("rejects unauthenticated chat requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      payload: { channel: "ems", externalUserId: "user-1", message: "Въпрос" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    await app.close();
  });

  it("returns the answer contract and stores the exchange", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tenantId: "ems",
        channel: "ems",
        externalUserId: "user-1",
        message: "Какъв е срокът?",
        context: { jurisdiction: "BG", asOf: "2026-08-13" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "needs_clarification",
      assistantProfile: "registered_customer",
      asOf: "2026-08-13",
      sources: [],
    });
    expect(response.json().requestId).toBeTypeOf("string");
    expect(conversations.exchanges).toHaveLength(1);
    expect(conversations.exchanges[0]?.tenantId).toBe("ems");
    await app.close();
  });

  it("accepts a raw document and exposes its status", async () => {
    const app = await buildApp();
    const multipart = multipartPayload(
      {
        tenantId: "ems",
        title: "Вътрешна процедура",
        category: "accounting",
        sourceType: "internal",
        accessLevel: "tenant",
        jurisdiction: "BG",
      },
      "Тестово съдържание",
    );
    const upload = await app.inject({
      method: "POST",
      url: "/v1/admin/documents",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": multipart.contentType,
      },
      payload: multipart.body,
    });

    expect(upload.statusCode).toBe(202);
    expect(upload.json().status).toBe("accepted");
    expect(upload.json().sha256).toMatch(/^[a-f0-9]{64}$/);

    const status = await app.inject({
      method: "GET",
      url: `/v1/admin/documents/${upload.json().documentId}`,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      tenantId: "ems",
      status: "accepted",
      originalFilename: "policy.txt",
    });
    await app.close();
  });

  it("passes registration progress to the provider and returns structured registration updates", async () => {
    const calls: Parameters<ChatProvider["generate"]>[0][] = [];
    const provider: ChatProvider = {
      async generate(input) {
        calls.push(input);
        return {
          status: "answered",
          answer: "Добавих разработката на софтуер.",
          asOf: "2026-08-18",
          sources: [],
          warnings: [],
          registrationUpdate: {
            activityDescription: "Консултантска дейност и разработка на софтуер.",
          },
        };
      },
    };
    const app = await buildApp(provider);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        channel: "easystart-web",
        externalUserId: "easystart-user-1",
        message: "Добави разработка на софтуер.",
        context: {
          jurisdiction: "BG",
          registrationProgress: {
            currentStep: 4,
            completedSteps: [1, 2, 3],
            companyCopy: {
              has_source_company: true,
              source_company_uic: "202403817",
              source_company: { should_be_stripped: true },
            },
            copiedCompanyDetails: { activity: "Консултантска дейност" },
            activityDescription: "Консултантска дейност",
            companyName: null,
            companyNameCheck: {},
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(calls[0]?.context?.registrationProgress).toEqual({
      currentStep: 4,
      completedSteps: [1, 2, 3],
      companyCopy: {
        has_source_company: true,
        source_company_uic: "202403817",
      },
      copiedCompanyDetails: { activity: "Консултантска дейност" },
      activityDescription: "Консултантска дейност",
      companyName: null,
      companyNameCheck: {},
    });
    expect(response.json().registrationUpdate).toEqual({
      activityDescription: "Консултантска дейност и разработка на софтуер.",
    });
    await app.close();
  });

  it("allows only the central knowledge admin to upload and read another tenant's document", async () => {
    const app = await buildApp();
    const multipart = multipartPayload(
      {
        tenantId: "easystart",
        title: "Проверена информация за регистрация",
        category: "company-registration",
        sourceType: "professional",
        accessLevel: "tenant",
        publiclyAccessible: true,
        jurisdiction: "BG",
      },
      "Проверено съдържание",
    );

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/admin/documents",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("TENANT_MISMATCH");

    const upload = await app.inject({
      method: "POST",
      url: "/v1/admin/documents",
      headers: {
        authorization: `Bearer ${knowledgeAdminKey}`,
        "content-type": multipart.contentType,
      },
      payload: multipart.body,
    });
    expect(upload.statusCode).toBe(202);
    expect(documents.documents.get(upload.json().documentId)).toMatchObject({
      tenantId: "easystart",
      publiclyAccessible: true,
    });

    const status = await app.inject({
      method: "GET",
      url: `/v1/admin/documents/${upload.json().documentId}`,
      headers: { authorization: `Bearer ${knowledgeAdminKey}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      tenantId: "easystart",
      publiclyAccessible: true,
      status: "accepted",
    });
    await app.close();
  });

  it("serves the Leon chatbot landing page", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Леон AI");
    expect(response.body).toContain("Бизнес въпросите ти имат");
    await app.close();
  });

  it("retries a failed document without creating a duplicate", async () => {
    const app = await buildApp();
    const multipart = multipartPayload(
      {
        tenantId: "ems",
        title: "Retry policy",
        category: "accounting",
        sourceType: "internal",
        accessLevel: "tenant",
        jurisdiction: "BG",
      },
      "Retry content",
    );
    const upload = await app.inject({
      method: "POST",
      url: "/v1/admin/documents",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    const documentId = upload.json().documentId as string;
    await documents.updateStatus(documentId, "failed", "temporary error");

    const retry = await app.inject({
      method: "POST",
      url: `/v1/admin/documents/${documentId}/retry`,
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ documentId, status: "accepted", attemptCount: 0 });
    expect(documents.documents.size).toBe(1);
    expect(documents.documents.get(documentId)).not.toHaveProperty("error");
    await app.close();
  });

  it("rejects a tenant mismatch", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tenantId: "other-client",
        channel: "ems",
        externalUserId: "user-1",
        message: "Въпрос",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TENANT_MISMATCH");
    await app.close();
  });

  it("rejects the removed accounting-client profile", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        assistantProfile: "accounting_client",
        channel: "platform",
        externalUserId: "user-1",
        message: "Въпрос",
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("does not allow a browser-facing credential to elevate its profile", async () => {
    const app = await buildApp(new FakeChatProvider(), ["public_pre_registration"]);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        assistantProfile: "registered_customer",
        channel: "public-web",
        externalUserId: "anonymous-1",
        message: "Въпрос",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ASSISTANT_PROFILE_FORBIDDEN");
    await app.close();
  });

  it("enforces the public daily quota", async () => {
    const app = await buildApp();
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat",
        headers: { authorization: `Bearer ${apiKey}` },
        payload: {
          assistantProfile: "public_pre_registration",
          channel: "public-web",
          externalUserId: "anonymous-1",
          message: "Как се регистрирам?",
        },
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        assistantProfile: "public_pre_registration",
        channel: "public-web",
        externalUserId: "anonymous-1",
        message: "Още един въпрос",
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("CHAT_QUOTA_EXCEEDED");
    expect(limited.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("maps provider failures to a stable 503 error", async () => {
    const unavailableProvider: ChatProvider = {
      async generate() {
        throw new ChatProviderUnavailableError();
      },
    };
    const app = await buildApp(unavailableProvider);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        channel: "ems",
        externalUserId: "user-1",
        message: "Въпрос",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    await app.close();
  });
});
