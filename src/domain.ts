export const answerStatuses = [
  "answered",
  "out_of_scope",
  "insufficient_evidence",
  "needs_clarification",
  "human_escalation",
  "temporarily_unavailable",
] as const;

export type AnswerStatus = (typeof answerStatuses)[number];

export interface SourceCitation {
  title: string;
  url?: string;
  sourceType: string;
  validFrom?: string;
  validTo?: string | null;
  retrievedAt: string;
}

export interface ChatContext {
  jurisdiction?: string;
  asOf?: string;
}

export interface ChatProviderInput {
  tenantId: string;
  assistantProfile: AssistantProfile;
  externalOrganizationId?: string;
  message: string;
  context?: ChatContext;
}

export interface ChatProviderResult {
  status: AnswerStatus;
  answer: string;
  asOf: string;
  sources: SourceCitation[];
  warnings: string[];
}

export interface ChatProvider {
  generate(input: ChatProviderInput): Promise<ChatProviderResult>;
}

export class ChatProviderUnavailableError extends Error {
  constructor(message = "AI provider is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatProviderUnavailableError";
  }
}

export interface ConversationExchange {
  tenantId: string;
  assistantProfile: AssistantProfile;
  externalUserId: string;
  externalOrganizationId?: string;
  conversationId: string;
  channel: string;
  userMessage: string;
  assistantMessage: string;
  status: AnswerStatus;
  requestId: string;
  retentionDays: number;
  createdAt: Date;
}

export interface ConversationStore {
  saveExchange(exchange: ConversationExchange): Promise<void>;
  close(): Promise<void>;
}

export const documentStatuses = [
  "accepted",
  "processing",
  "ready",
  "failed",
  "archived",
] as const;

export type DocumentStatus = (typeof documentStatuses)[number];

export interface DocumentRecord {
  id: string;
  tenantId: string;
  title: string;
  category: string;
  sourceType: "legislation" | "institutional" | "internal" | "professional";
  accessLevel: "global" | "tenant";
  organizationId?: string;
  jurisdiction: string;
  publisher?: string;
  sourceUrl?: string;
  publishedAt?: string;
  validFrom?: string;
  validTo?: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  status: DocumentStatus;
  error?: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  workerId?: string;
  openAiFileId?: string;
  vectorStoreId?: string;
  vectorStoreFileId?: string;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRepository {
  save(document: DocumentRecord): Promise<void>;
  findById(tenantId: string, id: string, canReadGlobal: boolean): Promise<DocumentRecord | null>;
  retryFailed(id: string): Promise<DocumentRecord | null>;
  updateStatus(id: string, status: DocumentStatus, error?: string): Promise<void>;
  close(): Promise<void>;
}

export interface DocumentIndexResult {
  openAiFileId: string;
  vectorStoreId: string;
  vectorStoreFileId: string;
  indexedAt: Date;
}

export interface DocumentWorkRepository extends DocumentRepository {
  claimNext(input: {
    workerId: string;
    leaseSeconds: number;
    maxAttempts: number;
    now: Date;
  }): Promise<DocumentRecord | null>;
  extendLease(input: {
    documentId: string;
    workerId: string;
    leaseSeconds: number;
    now: Date;
  }): Promise<boolean>;
  recordOpenAiFile(input: {
    documentId: string;
    workerId: string;
    openAiFileId: string;
  }): Promise<void>;
  markReady(input: {
    documentId: string;
    workerId: string;
    result: DocumentIndexResult;
  }): Promise<void>;
  markFailed(input: {
    documentId: string;
    workerId: string;
    error: string;
    nextAttemptAt: Date | null;
  }): Promise<void>;
}

export interface StoredRawDocument {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface RawDocumentStorage {
  save(input: {
    tenantId: string;
    documentId: string;
    filename: string;
    content: Buffer;
  }): Promise<StoredRawDocument>;
  read(storageKey: string): Promise<Buffer>;
}

export interface DocumentProcessor {
  enqueue(document: DocumentRecord): Promise<void>;
}

export interface DocumentIndexer {
  index(input: {
    document: DocumentRecord;
    content: Buffer;
    onFileUploaded(openAiFileId: string): Promise<void>;
  }): Promise<DocumentIndexResult>;
}
import type { AssistantProfile } from "./profiles.js";
