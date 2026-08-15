import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

import type { Pool } from "pg";
import { z } from "zod";

import type {
  DocumentProcessor,
  DocumentRecord,
  DocumentRepository,
  DocumentIndexResult,
  DocumentStatus,
  DocumentWorkRepository,
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
    publiclyAccessible: z.boolean().default(false),
    organizationId: z.string().min(1).max(200).optional(),
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
  })
  .refine((value) => value.accessLevel !== "global" || !value.organizationId, {
    message: "organizationId is only valid for tenant documents",
    path: ["organizationId"],
  })
  .refine((value) => !value.publiclyAccessible || value.accessLevel === "tenant", {
    message: "publiclyAccessible is only valid for tenant documents",
    path: ["publiclyAccessible"],
  })
  .refine((value) => !value.publiclyAccessible || !value.organizationId, {
    message: "organization documents cannot be publicly accessible",
    path: ["publiclyAccessible"],
  })
  .refine((value) => !value.publiclyAccessible || value.sourceType !== "internal", {
    message: "internal documents cannot be publicly accessible",
    path: ["publiclyAccessible"],
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

  async read(storageKey: string): Promise<Buffer> {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Invalid document storage path");
    }
    return readFile(path);
  }
}

export class InMemoryDocumentRepository implements DocumentWorkRepository {
  readonly documents = new Map<string, DocumentRecord>();

  async save(document: DocumentRecord): Promise<void> {
    this.documents.set(document.id, document);
  }

  async findById(
    tenantId: string,
    id: string,
    canReadGlobal: boolean,
    canReadAllTenants = false,
  ): Promise<DocumentRecord | null> {
    const document = this.documents.get(id);
    if (!document) return null;
    if (
      !canReadAllTenants &&
      document.tenantId !== tenantId &&
      !(canReadGlobal && document.accessLevel === "global")
    ) {
      return null;
    }
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

  async retryFailed(id: string): Promise<DocumentRecord | null> {
    const document = this.documents.get(id);
    if (!document || document.status !== "failed") return null;
    const retried: DocumentRecord = {
      ...document,
      status: "accepted",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      leaseUntil: null,
      updatedAt: new Date(),
    };
    delete retried.error;
    delete retried.workerId;
    this.documents.set(id, retried);
    return retried;
  }

  async claimNext(input: {
    workerId: string;
    leaseSeconds: number;
    maxAttempts: number;
    now: Date;
  }): Promise<DocumentRecord | null> {
    const candidate = [...this.documents.values()]
      .filter((document) => {
        if (document.attemptCount >= input.maxAttempts || document.status === "archived") return false;
        if (document.status === "processing") {
          return document.leaseUntil !== null && document.leaseUntil <= input.now;
        }
        return (
          (document.status === "accepted" || document.status === "failed") &&
          document.nextAttemptAt !== null &&
          document.nextAttemptAt <= input.now
        );
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    if (!candidate) return null;

    const claimed: DocumentRecord = {
      ...candidate,
      status: "processing",
      attemptCount: candidate.attemptCount + 1,
      nextAttemptAt: null,
      leaseUntil: new Date(input.now.getTime() + input.leaseSeconds * 1000),
      workerId: input.workerId,
      updatedAt: input.now,
    };
    delete claimed.error;
    this.documents.set(candidate.id, claimed);
    return claimed;
  }

  async extendLease(input: {
    documentId: string;
    workerId: string;
    leaseSeconds: number;
    now: Date;
  }): Promise<boolean> {
    const document = this.documents.get(input.documentId);
    if (!document || document.status !== "processing" || document.workerId !== input.workerId) return false;
    this.documents.set(document.id, {
      ...document,
      leaseUntil: new Date(input.now.getTime() + input.leaseSeconds * 1000),
      updatedAt: input.now,
    });
    return true;
  }

  async recordOpenAiFile(input: {
    documentId: string;
    workerId: string;
    openAiFileId: string;
  }): Promise<void> {
    const document = this.requireOwnedProcessingDocument(input.documentId, input.workerId);
    this.documents.set(document.id, { ...document, openAiFileId: input.openAiFileId, updatedAt: new Date() });
  }

  async markReady(input: {
    documentId: string;
    workerId: string;
    result: DocumentIndexResult;
  }): Promise<void> {
    const document = this.requireOwnedProcessingDocument(input.documentId, input.workerId);
    const ready: DocumentRecord = {
      ...document,
      status: "ready",
      openAiFileId: input.result.openAiFileId,
      vectorStoreId: input.result.vectorStoreId,
      vectorStoreFileId: input.result.vectorStoreFileId,
      indexedAt: input.result.indexedAt,
      nextAttemptAt: null,
      leaseUntil: null,
      updatedAt: input.result.indexedAt,
    };
    delete ready.error;
    delete ready.workerId;
    this.documents.set(document.id, ready);
  }

  async markFailed(input: {
    documentId: string;
    workerId: string;
    error: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    const document = this.requireOwnedProcessingDocument(input.documentId, input.workerId);
    const failed: DocumentRecord = {
      ...document,
      status: "failed",
      error: input.error,
      nextAttemptAt: input.nextAttemptAt,
      leaseUntil: null,
      updatedAt: new Date(),
    };
    delete failed.workerId;
    this.documents.set(document.id, failed);
  }

  private requireOwnedProcessingDocument(documentId: string, workerId: string): DocumentRecord {
    const document = this.documents.get(documentId);
    if (!document || document.status !== "processing" || document.workerId !== workerId) {
      throw new Error("Document lease is not owned by this worker");
    }
    return document;
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
  publicly_accessible: boolean;
  organization_id: string | null;
  jurisdiction: string;
  publisher: string | null;
  source_url: string | null;
  published_at: string | Date | null;
  valid_from: string | Date | null;
  valid_to: string | Date | null;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  storage_key: string;
  status: DocumentStatus;
  error: string | null;
  attempt_count: number;
  next_attempt_at: Date | null;
  lease_until: Date | null;
  worker_id: string | null;
  openai_file_id: string | null;
  vector_store_id: string | null;
  vector_store_file_id: string | null;
  indexed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    category: row.category,
    sourceType: row.source_type,
    accessLevel: row.access_level,
    publiclyAccessible: row.publicly_accessible,
    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
    jurisdiction: row.jurisdiction,
    ...(row.publisher ? { publisher: row.publisher } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.published_at ? { publishedAt: dateOnly(row.published_at) } : {}),
    ...(row.valid_from ? { validFrom: dateOnly(row.valid_from) } : {}),
    ...(row.valid_to ? { validTo: dateOnly(row.valid_to) } : {}),
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageKey: row.storage_key,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    leaseUntil: row.lease_until,
    ...(row.worker_id ? { workerId: row.worker_id } : {}),
    ...(row.openai_file_id ? { openAiFileId: row.openai_file_id } : {}),
    ...(row.vector_store_id ? { vectorStoreId: row.vector_store_id } : {}),
    ...(row.vector_store_file_id ? { vectorStoreFileId: row.vector_store_file_id } : {}),
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresDocumentRepository implements DocumentWorkRepository {
  constructor(private readonly pool: Pool) {}

  async save(document: DocumentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO documents (
         id, tenant_id, title, category, source_type, access_level, publicly_accessible, organization_id, jurisdiction,
         publisher, source_url, published_at, valid_from, valid_to,
         original_filename, mime_type, size_bytes, sha256, storage_key,
         status, error, attempt_count, next_attempt_at, lease_until, worker_id,
         openai_file_id, vector_store_id, vector_store_file_id, indexed_at,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
         $26, $27, $28, $29, $30, $31
       )`,
      [
        document.id,
        document.tenantId,
        document.title,
        document.category,
        document.sourceType,
        document.accessLevel,
        document.publiclyAccessible ?? false,
        document.organizationId ?? null,
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
        document.attemptCount,
        document.nextAttemptAt,
        document.leaseUntil,
        document.workerId ?? null,
        document.openAiFileId ?? null,
        document.vectorStoreId ?? null,
        document.vectorStoreFileId ?? null,
        document.indexedAt,
        document.createdAt,
        document.updatedAt,
      ],
    );
  }

  async findById(
    tenantId: string,
    id: string,
    canReadGlobal: boolean,
    canReadAllTenants = false,
  ): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT * FROM documents
       WHERE id = $1 AND ($4 = true OR tenant_id = $2 OR ($3 = true AND access_level = 'global'))`,
      [id, tenantId, canReadGlobal, canReadAllTenants],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: DocumentStatus, error?: string): Promise<void> {
    await this.pool.query(
      "UPDATE documents SET status = $2, error = $3, updated_at = now() WHERE id = $1",
      [id, status, error ?? null],
    );
  }

  async retryFailed(id: string): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `UPDATE documents
       SET status = 'accepted',
           error = NULL,
           attempt_count = 0,
           next_attempt_at = now(),
           lease_until = NULL,
           worker_id = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'failed'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async claimNext(input: {
    workerId: string;
    leaseSeconds: number;
    maxAttempts: number;
    now: Date;
  }): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `WITH candidate AS (
         SELECT id
         FROM documents
         WHERE attempt_count < $3
           AND status <> 'archived'
           AND (
             (status IN ('accepted', 'failed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= $4)
             OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until < $4)
           )
         ORDER BY COALESCE(next_attempt_at, lease_until, created_at), created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE documents AS document
       SET status = 'processing',
           attempt_count = document.attempt_count + 1,
           next_attempt_at = NULL,
           lease_until = $4 + ($2::double precision * interval '1 second'),
           worker_id = $1,
           error = NULL,
           updated_at = $4
       FROM candidate
       WHERE document.id = candidate.id
       RETURNING document.*`,
      [input.workerId, input.leaseSeconds, input.maxAttempts, input.now],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async extendLease(input: {
    documentId: string;
    workerId: string;
    leaseSeconds: number;
    now: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE documents
       SET lease_until = $4 + ($3::double precision * interval '1 second'), updated_at = $4
       WHERE id = $1 AND worker_id = $2 AND status = 'processing'`,
      [input.documentId, input.workerId, input.leaseSeconds, input.now],
    );
    return result.rowCount === 1;
  }

  async recordOpenAiFile(input: {
    documentId: string;
    workerId: string;
    openAiFileId: string;
  }): Promise<void> {
    await this.assertUpdated(
      `UPDATE documents
       SET openai_file_id = $3, updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND status = 'processing'`,
      [input.documentId, input.workerId, input.openAiFileId],
    );
  }

  async markReady(input: {
    documentId: string;
    workerId: string;
    result: DocumentIndexResult;
  }): Promise<void> {
    await this.assertUpdated(
      `UPDATE documents
       SET status = 'ready',
           error = NULL,
           next_attempt_at = NULL,
           lease_until = NULL,
           worker_id = NULL,
           openai_file_id = $3,
           vector_store_id = $4,
           vector_store_file_id = $5,
           indexed_at = $6,
           updated_at = $6
       WHERE id = $1 AND worker_id = $2 AND status = 'processing'`,
      [
        input.documentId,
        input.workerId,
        input.result.openAiFileId,
        input.result.vectorStoreId,
        input.result.vectorStoreFileId,
        input.result.indexedAt,
      ],
    );
  }

  async markFailed(input: {
    documentId: string;
    workerId: string;
    error: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    await this.assertUpdated(
      `UPDATE documents
       SET status = 'failed',
           error = $3,
           next_attempt_at = $4,
           lease_until = NULL,
           worker_id = NULL,
           updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND status = 'processing'`,
      [input.documentId, input.workerId, input.error, input.nextAttemptAt],
    );
  }

  private async assertUpdated(query: string, values: unknown[]): Promise<void> {
    const result = await this.pool.query(query, values);
    if (result.rowCount !== 1) throw new Error("Document lease was lost before update");
  }

  async close(): Promise<void> {}
}

export class PendingDocumentProcessor implements DocumentProcessor {
  async enqueue(): Promise<void> {
    // The document row is already durable and immediately eligible for the polling worker.
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
      publiclyAccessible: input.metadata.publiclyAccessible,
      ...(input.metadata.organizationId ? { organizationId: input.metadata.organizationId } : {}),
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
      attemptCount: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      indexedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(document);
    await this.processor.enqueue(document);
    return document;
  }
}
