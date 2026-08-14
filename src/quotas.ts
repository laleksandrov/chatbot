import { createHmac } from "node:crypto";

import type { Pool } from "pg";

import type { AssistantProfile } from "./profiles.js";

export interface ChatQuotaInput {
  tenantId: string;
  assistantProfile: AssistantProfile;
  externalUserId: string;
  limit: number;
  windowSeconds: number;
  now: Date;
}

export interface ChatQuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface ChatQuotaStore {
  consume(input: ChatQuotaInput): Promise<ChatQuotaResult>;
  close(): Promise<void>;
}

function windowStart(now: Date, windowSeconds: number): Date {
  const windowMilliseconds = windowSeconds * 1_000;
  return new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds);
}

export class InMemoryChatQuotaStore implements ChatQuotaStore {
  private readonly counters = new Map<string, number>();

  async consume(input: ChatQuotaInput): Promise<ChatQuotaResult> {
    const start = windowStart(input.now, input.windowSeconds);
    const key = [input.tenantId, input.assistantProfile, input.externalUserId, start.toISOString()].join(":");
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    return {
      allowed: count <= input.limit,
      limit: input.limit,
      remaining: Math.max(0, input.limit - count),
      resetAt: new Date(start.getTime() + input.windowSeconds * 1_000),
    };
  }

  async close(): Promise<void> {}
}

interface QuotaRow {
  message_count: number;
  window_start: Date;
}

export class PostgresChatQuotaStore implements ChatQuotaStore {
  constructor(
    private readonly pool: Pool,
    private readonly hashKey: Buffer,
  ) {}

  async consume(input: ChatQuotaInput): Promise<ChatQuotaResult> {
    const start = windowStart(input.now, input.windowSeconds);
    const subjectHash = createHmac("sha256", this.hashKey)
      .update([input.tenantId, input.assistantProfile, input.externalUserId].join("\0"))
      .digest("hex");
    const result = await this.pool.query<QuotaRow>(
      `INSERT INTO chat_quota_windows (
         tenant_id, assistant_profile, subject_hash, window_start, message_count, updated_at
       ) VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (tenant_id, assistant_profile, subject_hash, window_start)
       DO UPDATE SET
         message_count = chat_quota_windows.message_count + 1,
         updated_at = EXCLUDED.updated_at
       RETURNING message_count, window_start`,
      [input.tenantId, input.assistantProfile, subjectHash, start, input.now],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Quota counter update returned no row");
    return {
      allowed: row.message_count <= input.limit,
      limit: input.limit,
      remaining: Math.max(0, input.limit - row.message_count),
      resetAt: new Date(start.getTime() + input.windowSeconds * 1_000),
    };
  }

  async close(): Promise<void> {}
}
