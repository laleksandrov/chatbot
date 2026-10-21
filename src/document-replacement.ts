import { HttpError } from "./auth.js";
import type { DocumentRecord, DocumentReplacement } from "./domain.js";

// Validate again under the repository lock, not only in the HTTP handler.
export function validateReplacement(old: DocumentRecord | undefined, next: DocumentRecord | undefined, input: DocumentReplacement): boolean {
  if (!old || !next) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  if (old.id === next.id || old.sha256 !== input.oldSha256 || next.sha256 !== input.newSha256 || old.sha256 === next.sha256) {
    throw new HttpError(409, "REPLACEMENT_HASH_CONFLICT", "Document identity or hash changed");
  }
  for (const key of ["tenantId", "category", "sourceType", "accessLevel", "organizationId", "jurisdiction", "publisher", "sourceUrl"] as const) {
    if (old[key] !== next[key]) throw new HttpError(409, "REPLACEMENT_SCOPE_CONFLICT", `Different ${key}`);
  }
  if (!old.sourceUrl || (old.publiclyAccessible ?? false) !== (next.publiclyAccessible ?? false)) {
    throw new HttpError(409, "REPLACEMENT_SCOPE_CONFLICT", "Missing source URL or changed public access");
  }
  if (next.status !== "ready" || !next.indexedAt || !next.openAiFileId || !next.vectorStoreId) {
    throw new HttpError(409, "REPLACEMENT_NOT_READY", "Replacement must be indexed and ready");
  }
  if (old.status === "archived" && old.supersededBy === next.id) return false;
  if (old.status !== "ready" || !old.openAiFileId || old.vectorStoreId !== next.vectorStoreId || old.openAiFileId === next.openAiFileId) {
    throw new HttpError(409, "REPLACEMENT_CONFLICT", "Old document is not an independently indexed ready version");
  }
  return true;
}
