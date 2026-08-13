import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

import type { Pool } from "pg";
import { z } from "zod";

import type {
  DocumentProcessor,
  DocumentRecord,
  DocumentRepository,
  DocumentStatus,
  RawDocumentStorage,
  StoredRawDocument,
} from "./domain.js";

export const documentMetadataSchema = z
  .object({
    tenantId: z.string().min(1).optional(),
    title: z.string().min(1).max(300),
    category: z.string().min(1).max(100),
    sourceType: z.enum(["legislation", "institutional", "internal", "professional"]),
    accessLevel: z.enum(["global", "tenant"]).default("tenant"),
    jurisdiction: z.string().min(2).max(20).default("BG"),
    publisher: z.string().min(1).max(200).optional(),
    sourceUrl: z.url().optional(),
    publishedAt: z.iso.date().optional(),
    validFrom: z.iso.date().optional(),
    validTo: z.iso.date().optional(),
  })
  .refine((value) => !value.validFrom || !value.validTo || value.validTo >= value.validFrom, {
    message: "validTo must not be earlier than validFrom",
    path: ["validTo"],
  });

export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/html",
]);

export function assertAllowedMimeType(mimeType: string): void {
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error(`Unsupported document MIME type: ${mimeType}`);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150) || "file";
}

export class LocalRawDocumentStorage implements RawDocumentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root, "raw");
  }

  async save(input: {
    tenantId: string;
    documentId: string;
    filename: string;
    content: Buffer;
  }): Promise<StoredRawDocument> {
    const tenant = safeSegment(input.tenantId);
    const filename = safeSegment(basename(input.filename));
    const directory = resolve(this.root, tenant, input.documentId);
    const path = resolve(directory, filename);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Invalid document storage path");
    }

    await mkdir(directory, { recursive: true });
    await writeFile(path, input.content, { flag: "wx" });

    return {
      storageKey: `${tenant}/${input.documentId}/${filename}`,
      sha256: createHash("sha256").update(input.content).digest("hex"),
      sizeBytes: input.content.length,
    };
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>();

  async save(document: DocumentRecord): Promise<void> {
    this.documents.set(document.id, document);
  }

  async findById(tenantId: string, id: string, canReadGlobal: boolean): Promise<DocumentRecord | null> {
    const document = this.documents.get(id);
    if (!document) return null;
    if (document.tenantId !== tenantId && !(canReadGlobal && document.accessLevel === "global")) return null;
    return document;
  }

  async updateStatus(id: string, status: DocumentStatus, error?: string): Promise<void> {
    const document = this.documents.get(id);
    if (!document) return;
    this.documents.set(id, {
      ...document,
      status,
      ...(error === undefined ? {} : { error }),
      updatedAt: new Date(),
    });
  }

  async close(): Promise<void> {}
}

interface DocumentRow {
  id: string;
  tenant_id: string;
  title: string;
  category: string;
  source_type: DocumentRecord["sourceType"];
  access_level: DocumentRecord["accessLevel"];
  jurisdiction: string;
  publisher: string | null;
  source_url: string | null;
  published_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  storage_key: string;
  status: DocumentStatus;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    category: row.category,
    sourceType: row.source_type,
    accessLevel: row.access_level,
    jurisdiction: row.jurisdiction,
    ...(row.publisher ? { publisher: row.publisher } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.valid_from ? { validFrom: row.valid_from } : {}),
    ...(row.valid_to ? { validTo: row.valid_to } : {}),
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageKey: row.storage_key,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async save(document: DocumentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO documents (
         id, tenant_id, title, category, source_type, access_level, jurisdiction,
         publisher, source_url, published_at, valid_from, valid_to,
         original_filename, mime_type, size_bytes, sha256, storage_key,
         status, error, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21
       )`,
      [
        document.id,
        document.tenantId,
        document.title,
        document.category,
        document.sourceType,
        document.accessLevel,
        document.jurisdiction,
        document.publisher ?? null,
        document.sourceUrl ?? null,
        document.publishedAt ?? null,
        document.validFrom ?? null,
        document.validTo ?? null,
        document.originalFilename,
        document.mimeType,
        document.sizeBytes,
        document.sha256,
        document.storageKey,
        document.status,
        document.error ?? null,
        document.createdAt,
        document.updatedAt,
      ],
    );
  }

  async findById(tenantId: string, id: string, canReadGlobal: boolean): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT * FROM documents
       WHERE id = $1 AND (tenant_id = $2 OR ($3 = true AND access_level = 'global'))`,
      [id, tenantId, canReadGlobal],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: DocumentStatus, error?: string): Promise<void> {
    await this.pool.query(
      "UPDATE documents SET status = $2, error = $3, updated_at = now() WHERE id = $1",
      [id, status, error ?? null],
    );
  }

  async close(): Promise<void> {}
}

export class PendingDocumentProcessor implements DocumentProcessor {
  async enqueue(): Promise<void> {
    // The durable worker/OpenAI File Search adapter is the next vertical slice.
  }
}

export class DocumentIngestionService {
  constructor(
    private readonly rawStorage: RawDocumentStorage,
    private readonly repository: DocumentRepository,
    private readonly processor: DocumentProcessor,
  ) {}

  async ingest(input: {
    tenantId: string;
    metadata: DocumentMetadata;
    filename: string;
    mimeType: string;
    content: Buffer;
  }): Promise<DocumentRecord> {
    assertAllowedMimeType(input.mimeType);
    const id = randomUUID();
    const stored = await this.rawStorage.save({
      tenantId: input.tenantId,
      documentId: id,
      filename: input.filename,
      content: input.content,
    });
    const now = new Date();
    const document: DocumentRecord = {
      id,
      tenantId: input.tenantId,
      title: input.metadata.title,
      category: input.metadata.category,
      sourceType: input.metadata.sourceType,
      accessLevel: input.metadata.accessLevel,
      jurisdiction: input.metadata.jurisdiction,
      ...(input.metadata.publisher ? { publisher: input.metadata.publisher } : {}),
      ...(input.metadata.sourceUrl ? { sourceUrl: input.metadata.sourceUrl } : {}),
      ...(input.metadata.publishedAt ? { publishedAt: input.metadata.publishedAt } : {}),
      ...(input.metadata.validFrom ? { validFrom: input.metadata.validFrom } : {}),
      ...(input.metadata.validTo ? { validTo: input.metadata.validTo } : {}),
      originalFilename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(document);
    await this.processor.enqueue(document);
    return document;
  }
}
