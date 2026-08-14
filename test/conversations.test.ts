import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresConversationStore } from "../src/conversations.js";

describe("PostgresConversationStore", () => {
  it("passes retention expiry as an unambiguous timestamp", async () => {
    const createdAt = new Date("2026-08-13T10:00:00.000Z");
    const query = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: "ems",
            assistant_profile: "registered_customer",
            external_organization_hash: null,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() } as unknown as Pool;
    const store = new PostgresConversationStore(pool, Buffer.alloc(32, 1), 180);

    await store.saveExchange({
      conversationId: "conversation-1",
      tenantId: "ems",
      externalUserId: "user-1",
      channel: "api",
      userMessage: "Question",
      assistantMessage: "Answer",
      status: "answered",
      requestId: "request-1",
      createdAt,
      assistantProfile: "registered_customer",
      retentionDays: 30,
    });

    const conversationInsert = query.mock.calls[1];
    expect(conversationInsert?.[0]).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)");
    expect(conversationInsert?.[1]?.[6]).toEqual(createdAt);
    expect(conversationInsert?.[1]?.[7]).toEqual(new Date("2026-09-12T10:00:00.000Z"));
  });
});
