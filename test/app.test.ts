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

const apiKey = "ems-test-key";

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

  async function buildApp(chatProvider: ChatProvider = new FakeChatProvider()) {
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
        },
      ],
      aiProvider: "fake",
      openAiModel: "gpt-5.6-terra",
      openAiReasoningEffort: "low",
      openAiFileSearchMaxResults: 10,
      conversationRetentionDays: 180,
      dataDir,
      maxDocumentBytes: 1024 * 1024,
    };

    return createApp({
      config,
      chatProvider,
      conversationStore: conversations,
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
