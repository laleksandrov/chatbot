import { describe, expect, it, vi } from "vitest";

import type { DocumentIndexer, DocumentRecord, RawDocumentStorage } from "../src/domain.js";
import { InMemoryDocumentRepository } from "../src/documents.js";
import { DocumentIngestionWorker } from "../src/ingestion-worker.js";
import { DocumentIndexingError } from "../src/openai-indexer.js";

const baseTime = new Date("2026-08-13T10:00:00Z");

function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "8b74e840-35d7-4e95-8317-b4d314c203e6",
    tenantId: "ems",
    title: "Test policy",
    category: "policy",
    sourceType: "internal",
    accessLevel: "tenant",
    jurisdiction: "BG",
    originalFilename: "policy.txt",
    mimeType: "text/plain",
    sizeBytes: 4,
    sha256: "hash",
    storageKey: "ems/document/policy.txt",
    status: "accepted",
    attemptCount: 0,
    nextAttemptAt: baseTime,
    leaseUntil: null,
    indexedAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

function buildWorker(
  repository: InMemoryDocumentRepository,
  indexer: DocumentIndexer,
  now: () => Date = () => baseTime,
): DocumentIngestionWorker {
  const rawStorage = { read: vi.fn().mockResolvedValue(Buffer.from("test")) } as unknown as RawDocumentStorage;
  return new DocumentIngestionWorker({
    repository,
    rawStorage,
    indexer,
    workerId: "worker-1",
    pollMs: 100,
    leaseSeconds: 30,
    maxAttempts: 3,
    retryBaseMs: 1_000,
    retryMaxMs: 10_000,
    now,
  });
}

describe("DocumentIngestionWorker", () => {
  it("indexes a claimed document and marks it ready", async () => {
    const repository = new InMemoryDocumentRepository();
    await repository.save(document());
    const index = vi.fn().mockImplementation(async ({ onFileUploaded }) => {
      await onFileUploaded("file_1");
      return {
        openAiFileId: "file_1",
        vectorStoreId: "vs_1",
        vectorStoreFileId: "file_1",
        indexedAt: baseTime,
      };
    });

    expect(await buildWorker(repository, { index }).processNext()).toBe(true);
    expect(repository.documents.get(document().id)).toMatchObject({
      status: "ready",
      attemptCount: 1,
      openAiFileId: "file_1",
      vectorStoreId: "vs_1",
    });
    expect(repository.documents.get(document().id)).not.toHaveProperty("workerId");
  });

  it("persists the uploaded file ID and schedules a transient retry", async () => {
    const repository = new InMemoryDocumentRepository();
    await repository.save(document());
    const index = vi.fn().mockImplementation(async ({ onFileUploaded }) => {
      await onFileUploaded("file_reusable");
      throw new Error("temporary network failure");
    });

    await buildWorker(repository, { index }).processNext();
    expect(repository.documents.get(document().id)).toMatchObject({
      status: "failed",
      openAiFileId: "file_reusable",
      nextAttemptAt: new Date("2026-08-13T10:00:01Z"),
    });
  });

  it("does not retry a permanent OpenAI validation failure", async () => {
    const repository = new InMemoryDocumentRepository();
    await repository.save(document());
    const index = vi.fn().mockRejectedValue(new DocumentIndexingError("unsupported file", false));

    await buildWorker(repository, { index }).processNext();
    expect(repository.documents.get(document().id)).toMatchObject({
      status: "failed",
      nextAttemptAt: null,
      error: "unsupported file",
    });
  });

  it("does not retry a permanent OpenAI HTTP error", async () => {
    const repository = new InMemoryDocumentRepository();
    await repository.save(document());
    const index = vi.fn().mockRejectedValue({ status: 400, message: "bad request" });

    await buildWorker(repository, { index }).processNext();
    expect(repository.documents.get(document().id)).toMatchObject({
      status: "failed",
      nextAttemptAt: null,
    });
  });

  it("reclaims work after a processing lease expires", async () => {
    const repository = new InMemoryDocumentRepository();
    await repository.save(document({
      status: "processing",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseUntil: new Date("2026-08-13T09:59:59Z"),
      workerId: "dead-worker",
    }));
    const index = vi.fn().mockResolvedValue({
      openAiFileId: "file_1",
      vectorStoreId: "vs_1",
      vectorStoreFileId: "file_1",
      indexedAt: baseTime,
    });

    await buildWorker(repository, { index }).processNext();
    expect(repository.documents.get(document().id)).toMatchObject({ status: "ready", attemptCount: 2 });
  });
});
