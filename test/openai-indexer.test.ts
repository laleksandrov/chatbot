import type OpenAI from "openai";
import type { VectorStoreFile } from "openai/resources/vector-stores/files";
import { describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "../src/domain.js";
import { OpenAIDocumentIndexer } from "../src/openai-indexer.js";

const baseTime = new Date("2026-08-13T10:00:00Z");

function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "8b74e840-35d7-4e95-8317-b4d314c203e6",
    tenantId: "ems",
    title: "Internal policy",
    category: "policy",
    sourceType: "internal",
    accessLevel: "tenant",
    jurisdiction: "BG",
    sourceUrl: "https://example.com/policy",
    validFrom: "2026-01-01",
    originalFilename: "policy.txt",
    mimeType: "text/plain",
    sizeBytes: 4,
    sha256: "hash",
    storageKey: "key",
    status: "processing",
    attemptCount: 1,
    nextAttemptAt: null,
    leaseUntil: new Date("2026-08-13T10:05:00Z"),
    workerId: "worker-1",
    indexedAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

function vectorFile(status: VectorStoreFile["status"], lastError: VectorStoreFile["last_error"] = null): VectorStoreFile {
  return {
    id: "file_1",
    object: "vector_store.file",
    created_at: 1,
    status,
    last_error: lastError,
    usage_bytes: 4,
    vector_store_id: "vs_1",
  };
}

describe("OpenAIDocumentIndexer", () => {
  it("uploads, attaches with tenant attributes and waits until ready", async () => {
    const createFile = vi.fn().mockResolvedValue({ id: "file_1" });
    const retrieve = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(vectorFile("completed"));
    const attach = vi.fn().mockResolvedValue(vectorFile("in_progress"));
    const client = {
      files: { create: createFile },
      vectorStores: { files: { retrieve, create: attach } },
    } as unknown as OpenAI;
    const onFileUploaded = vi.fn().mockResolvedValue(undefined);
    const indexer = new OpenAIDocumentIndexer({
      apiKey: "test-key",
      vectorStoreId: "vs_1",
      pollIntervalMs: 100,
      pollTimeoutMs: 1_000,
      client,
      sleep: async () => {},
      now: () => baseTime,
    });

    await expect(indexer.index({ document: document(), content: Buffer.from("test"), onFileUploaded }))
      .resolves.toEqual({
        openAiFileId: "file_1",
        vectorStoreId: "vs_1",
        vectorStoreFileId: "file_1",
        indexedAt: baseTime,
      });
    expect(onFileUploaded).toHaveBeenCalledWith("file_1");
    expect(attach.mock.calls[0]?.[1]).toMatchObject({
      file_id: "file_1",
      chunking_strategy: { type: "auto" },
      attributes: {
        tenantId: "ems",
        accessLevel: "tenant",
        title: "Internal policy",
        sourceType: "internal",
        retrievedAt: baseTime.toISOString(),
      },
    });
  });

  it("reuses a previously uploaded file", async () => {
    const createFile = vi.fn();
    const retrieve = vi.fn().mockResolvedValue(vectorFile("completed"));
    const client = {
      files: { create: createFile },
      vectorStores: { files: { retrieve, create: vi.fn() } },
    } as unknown as OpenAI;
    const indexer = new OpenAIDocumentIndexer({
      apiKey: "test-key",
      vectorStoreId: "vs_1",
      pollIntervalMs: 100,
      pollTimeoutMs: 1_000,
      client,
      now: () => baseTime,
    });

    await indexer.index({
      document: document({ openAiFileId: "file_1" }),
      content: Buffer.from("test"),
      onFileUploaded: vi.fn(),
    });
    expect(createFile).not.toHaveBeenCalled();
  });

  it("serializes date objects returned by PostgreSQL as vector-store attributes", async () => {
    const retrieve = vi.fn().mockRejectedValueOnce({ status: 404 });
    const attach = vi.fn().mockResolvedValue(vectorFile("completed"));
    const client = {
      files: { create: vi.fn().mockResolvedValue({ id: "file_1" }) },
      vectorStores: { files: { retrieve, create: attach } },
    } as unknown as OpenAI;
    const indexer = new OpenAIDocumentIndexer({
      apiKey: "test-key",
      vectorStoreId: "vs_1",
      pollIntervalMs: 100,
      pollTimeoutMs: 1_000,
      client,
    });

    await indexer.index({
      document: document({
        publishedAt: new Date("2024-01-08T00:00:00.000Z") as unknown as string,
        validFrom: new Date("2024-01-01T00:00:00.000Z") as unknown as string,
      }),
      content: Buffer.from("test"),
      onFileUploaded: vi.fn(),
    });

    expect(attach.mock.calls[0]?.[1]).toMatchObject({
      attributes: {
        publishedAt: "2024-01-08T00:00:00.000Z",
        validFrom: "2024-01-01T00:00:00.000Z",
      },
    });
  });

  it("marks public platform documents with an isolated public scope", async () => {
    const createFile = vi.fn().mockResolvedValue({ id: "file_1" });
    const retrieve = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(vectorFile("completed"));
    const attach = vi.fn().mockResolvedValue(vectorFile("in_progress"));
    const client = {
      files: { create: createFile },
      vectorStores: { files: { retrieve, create: attach } },
    } as unknown as OpenAI;
    const indexer = new OpenAIDocumentIndexer({
      apiKey: "test-key",
      vectorStoreId: "vs_1",
      pollIntervalMs: 100,
      pollTimeoutMs: 1_000,
      client,
      sleep: async () => {},
      now: () => baseTime,
    });

    await indexer.index({
      document: document({
        tenantId: "easystart",
        title: "EasyStart prices",
        sourceType: "professional",
        publiclyAccessible: true,
      }),
      content: Buffer.from("test"),
      onFileUploaded: async () => {},
    });

    expect(attach.mock.calls[0]?.[1]).toMatchObject({
      attributes: {
        tenantId: "easystart",
        accessLevel: "tenant",
        documentScope: "public",
      },
    });
  });

  it("classifies an invalid vector-store file as a permanent failure", async () => {
    const failed = vectorFile("failed", { code: "invalid_file", message: "invalid content" });
    const client = {
      files: { create: vi.fn() },
      vectorStores: { files: { retrieve: vi.fn().mockResolvedValue(failed), create: vi.fn() } },
    } as unknown as OpenAI;
    const indexer = new OpenAIDocumentIndexer({
      apiKey: "test-key",
      vectorStoreId: "vs_1",
      pollIntervalMs: 100,
      pollTimeoutMs: 1_000,
      client,
    });

    const result = indexer.index({
      document: document({ openAiFileId: "file_1" }),
      content: Buffer.from("test"),
      onFileUploaded: vi.fn(),
    });
    await expect(result).rejects.toMatchObject({ retryable: false });
  });
});
