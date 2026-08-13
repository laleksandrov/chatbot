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

export interface ConversationExchange {
  tenantId: string;
  externalUserId: string;
  conversationId: string;
  channel: string;
  userMessage: string;
  assistantMessage: string;
  status: AnswerStatus;
  requestId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRepository {
  save(document: DocumentRecord): Promise<void>;
  findById(tenantId: string, id: string, canReadGlobal: boolean): Promise<DocumentRecord | null>;
  updateStatus(id: string, status: DocumentStatus, error?: string): Promise<void>;
  close(): Promise<void>;
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
}

export interface DocumentProcessor {
  enqueue(document: DocumentRecord): Promise<void>;
}
