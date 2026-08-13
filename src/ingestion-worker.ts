import type { DocumentIndexer, DocumentWorkRepository, RawDocumentStorage } from "./domain.js";
import { DocumentIndexingError } from "./openai-indexer.js";

interface IngestionWorkerOptions {
  repository: DocumentWorkRepository;
  rawStorage: RawDocumentStorage;
  indexer: DocumentIndexer;
  workerId: string;
  pollMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (level: "info" | "error", message: string, details?: Record<string, unknown>) => void;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown ingestion error";
  return message.slice(0, 1_000);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DocumentIndexingError) return error.retryable;
  if (typeof error !== "object" || error === null || !("status" in error)) return true;
  const status = typeof error.status === "number" ? error.status : undefined;
  return status === undefined || status >= 500 || status === 408 || status === 409 || status === 429;
}

export class DocumentIngestionWorker {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: IngestionWorkerOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async processNext(): Promise<boolean> {
    const document = await this.options.repository.claimNext({
      workerId: this.options.workerId,
      leaseSeconds: this.options.leaseSeconds,
      maxAttempts: this.options.maxAttempts,
      now: this.now(),
    });
    if (!document) return false;

    const heartbeat = setInterval(() => {
      void this.options.repository.extendLease({
        documentId: document.id,
        workerId: this.options.workerId,
        leaseSeconds: this.options.leaseSeconds,
        now: this.now(),
      }).then((extended) => {
        if (!extended) this.options.log?.("error", "Document lease was lost", { documentId: document.id });
      }).catch((error: unknown) => {
        this.options.log?.("error", "Document lease heartbeat failed", {
          documentId: document.id,
          error: safeError(error),
        });
      });
    }, Math.max(1_000, Math.floor((this.options.leaseSeconds * 1_000) / 3)));
    heartbeat.unref();

    try {
      const content = await this.options.rawStorage.read(document.storageKey);
      const result = await this.options.indexer.index({
        document,
        content,
        onFileUploaded: async (openAiFileId) => {
          await this.options.repository.recordOpenAiFile({
            documentId: document.id,
            workerId: this.options.workerId,
            openAiFileId,
          });
        },
      });
      await this.options.repository.markReady({
        documentId: document.id,
        workerId: this.options.workerId,
        result,
      });
      this.options.log?.("info", "Document indexed", { documentId: document.id });
    } catch (error) {
      const retryable = isRetryable(error);
      const hasAttemptsLeft = document.attemptCount < this.options.maxAttempts;
      const retryDelay = Math.min(
        this.options.retryMaxMs,
        this.options.retryBaseMs * 2 ** Math.max(0, document.attemptCount - 1),
      );
      const nextAttemptAt = retryable && hasAttemptsLeft
        ? new Date(this.now().getTime() + retryDelay)
        : null;
      await this.options.repository.markFailed({
        documentId: document.id,
        workerId: this.options.workerId,
        error: safeError(error),
        nextAttemptAt,
      });
      this.options.log?.("error", "Document indexing failed", {
        documentId: document.id,
        retryable,
        nextAttemptAt: nextAttemptAt?.toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.processNext();
      if (!processed) await this.sleep(this.options.pollMs);
    }
  }
}
