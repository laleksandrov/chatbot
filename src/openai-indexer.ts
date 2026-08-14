import OpenAI, { toFile } from "openai";
import type { VectorStoreFile } from "openai/resources/vector-stores/files";

import type { DocumentIndexer, DocumentRecord } from "./domain.js";

export class DocumentIndexingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentIndexingError";
  }
}

interface OpenAIIndexerOptions {
  apiKey: string;
  vectorStoreId: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  client?: OpenAI;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

function attributeString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function attributesFor(document: DocumentRecord): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      documentId: document.id,
      tenantId: document.tenantId,
      title: document.title,
      category: document.category,
      sourceType: document.sourceType,
      accessLevel: document.accessLevel,
      organizationId: document.organizationId,
      documentScope: document.organizationId ? "organization" : document.accessLevel,
      jurisdiction: document.jurisdiction,
      publisher: document.publisher,
      sourceUrl: document.sourceUrl,
      publishedAt: document.publishedAt,
      validFrom: document.validFrom,
      validTo: document.validTo,
      retrievedAt: document.createdAt.toISOString(),
      sha256: document.sha256,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, attributeString(value).slice(0, 512)]),
  );
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

export class OpenAIDocumentIndexer implements DocumentIndexer {
  private readonly client: OpenAI;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: OpenAIIndexerOptions) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date());
  }

  async index(input: Parameters<DocumentIndexer["index"]>[0]) {
    let openAiFileId = input.document.openAiFileId;
    if (!openAiFileId) {
      const file = await this.client.files.create(
        {
          file: await toFile(input.content, input.document.originalFilename, {
            type: input.document.mimeType,
          }),
          purpose: "assistants",
        },
        { headers: { "X-Client-Request-Id": input.document.id } },
      );
      openAiFileId = file.id;
      await input.onFileUploaded(openAiFileId);
    }

    let vectorFile: VectorStoreFile | undefined;
    try {
      vectorFile = await this.client.vectorStores.files.retrieve(openAiFileId, {
        vector_store_id: this.options.vectorStoreId,
      });
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
    }

    if (!vectorFile) {
      vectorFile = await this.client.vectorStores.files.create(
        this.options.vectorStoreId,
        {
          file_id: openAiFileId,
          attributes: attributesFor(input.document),
          chunking_strategy: { type: "auto" },
        },
        { headers: { "X-Client-Request-Id": input.document.id } },
      );
    }

    const completed = await this.waitUntilReady(vectorFile);
    return {
      openAiFileId,
      vectorStoreId: this.options.vectorStoreId,
      vectorStoreFileId: completed.id,
      indexedAt: this.now(),
    };
  }

  private async waitUntilReady(initial: VectorStoreFile): Promise<VectorStoreFile> {
    let current = initial;
    const deadline = Date.now() + this.options.pollTimeoutMs;
    while (current.status === "in_progress") {
      if (Date.now() >= deadline) {
        throw new DocumentIndexingError("OpenAI vector-store processing timed out", true);
      }
      await this.sleep(this.options.pollIntervalMs);
      current = await this.client.vectorStores.files.retrieve(current.id, {
        vector_store_id: this.options.vectorStoreId,
      });
    }
    if (current.status === "completed") return current;

    const detail = current.last_error?.message ?? `status ${current.status}`;
    const retryable = current.last_error?.code === "server_error" || current.status === "cancelled";
    throw new DocumentIndexingError(`OpenAI vector-store processing failed: ${detail}`, retryable);
  }
}
