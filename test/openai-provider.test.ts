import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { ChatProviderUnavailableError } from "../src/domain.js";
import { OpenAIChatProvider } from "../src/openai-provider.js";

function buildProvider(parse: ReturnType<typeof vi.fn>): OpenAIChatProvider {
  const client = { responses: { parse } } as unknown as OpenAI;
  return new OpenAIChatProvider({
    apiKey: "test-key",
    model: "gpt-5.6-terra",
    vectorStoreId: "vs_test",
    reasoningEffort: "low",
    maxResults: 10,
    client,
  });
}

describe("OpenAIChatProvider", () => {
  it("uses tenant-safe File Search and maps verified evidence", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "answered",
        answer: "Срокът е посочен в използвания нормативен източник.",
        asOf: "2026-08-13",
        evidenceFileIds: ["file-law"],
        warnings: [],
      },
      output: [
        {
          id: "search-1",
          type: "file_search_call",
          status: "completed",
          queries: ["срок"],
          results: [
            {
              file_id: "file-law",
              filename: "zdds.txt",
              score: 0.91,
              text: "Извлечен нормативен текст",
              attributes: {
                title: "Закон за данък върху добавената стойност",
                sourceType: "legislation",
                sourceUrl: "https://dv.parliament.bg/",
                validFrom: "2026-01-01",
                retrievedAt: "2026-08-12T10:00:00Z",
                accessLevel: "global",
              },
            },
          ],
        },
      ],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "ems",
      message: "Какъв е срокът?",
      context: { jurisdiction: "BG", asOf: "2026-08-13" },
    });

    expect(result).toMatchObject({
      status: "answered",
      asOf: "2026-08-13",
      sources: [
        {
          title: "Закон за данък върху добавената стойност",
          sourceType: "legislation",
          url: "https://dv.parliament.bg/",
          validFrom: "2026-01-01",
        },
      ],
    });

    const request = parse.mock.calls[0]?.[0] as {
      model: string;
      store: boolean;
      include: string[];
      tools: Array<{ filters: unknown; vector_store_ids: string[] }>;
    };
    expect(request.model).toBe("gpt-5.6-terra");
    expect(request.store).toBe(false);
    expect(request.include).toContain("file_search_call.results");
    expect(request.tools[0]?.vector_store_ids).toEqual(["vs_test"]);
    expect(request.tools[0]?.filters).toEqual({
      type: "or",
      filters: [
        { key: "accessLevel", type: "eq", value: "global" },
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "ems" },
          ],
        },
      ],
    });
  });

  it("downgrades an answered response without retrieved evidence", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "answered",
        answer: "Непроверен отговор",
        asOf: "2026-08-13",
        evidenceFileIds: ["file-not-retrieved"],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({ tenantId: "ems", message: "Въпрос" });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
    expect(result.answer).not.toContain("Непроверен отговор");
  });

  it("converts SDK failures to a provider availability error", async () => {
    const provider = buildProvider(vi.fn().mockRejectedValue(new Error("network failure")));

    await expect(provider.generate({ tenantId: "ems", message: "Въпрос" })).rejects.toBeInstanceOf(
      ChatProviderUnavailableError,
    );
  });
});
