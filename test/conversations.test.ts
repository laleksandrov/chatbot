import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresConversationStore } from "../src/conversations.js";

describe("PostgresConversationStore", () => {
  it("passes retention expiry as an unambiguous timestamp", async () => {
    const createdAt = new Date("2026-08-13T10:00:00.000Z");
    const query = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ tenant_id: "ems" }] })
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
    });

    const conversationInsert = query.mock.calls[1];
    expect(conversationInsert?.[0]).toContain("VALUES ($1, $2, $3, $4, $5, $5, $6)");
    expect(conversationInsert?.[1]?.[4]).toEqual(createdAt);
    expect(conversationInsert?.[1]?.[5]).toEqual(new Date("2027-02-09T10:00:00.000Z"));
  });
});
