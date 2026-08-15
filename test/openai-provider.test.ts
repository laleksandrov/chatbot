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
  it("constrains the public profile to EasyStart registration and cost planning", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "out_of_scope",
        answer: "Този въпрос не е достъпен преди регистрация.",
        asOf: "2026-08-15",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "easystart",
      assistantProfile: "public_pre_registration",
      message: "Какво мога да правя в платформата?",
    });

    const request = parse.mock.calls[0]?.[0] as {
      instructions: string;
      tools: Array<{ filters: unknown }>;
    };
    expect(request.instructions).toContain("цени на платформата");
    expect(request.instructions).toContain("нотариални и банкови такси");
    expect(request.instructions).toContain("осигурителни вноски");
    expect(request.instructions).toContain("ориентировъчен сценарий");
    expect(request.instructions).toContain("не са пряко свързани");
    expect(request.tools[0]?.filters).toEqual({
      type: "or",
      filters: [
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "global" },
            { key: "sourceType", type: "ne", value: "internal" },
          ],
        },
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "easystart" },
            { key: "documentScope", type: "eq", value: "public" },
          ],
        },
      ],
    });
  });

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
      assistantProfile: "registered_customer",
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
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "global" },
            { key: "sourceType", type: "ne", value: "internal" },
          ],
        },
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "ems" },
            { key: "documentScope", type: "eq", value: "public" },
          ],
        },
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "ems" },
            { key: "documentScope", type: "eq", value: "tenant" },
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

    const result = await provider.generate({
      tenantId: "ems",
      assistantProfile: "registered_customer",
      message: "Въпрос",
    });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
    expect(result.answer).not.toContain("Непроверен отговор");
  });

  it("scopes accounting-client retrieval to the exact organization", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer: "Няма достатъчно данни.",
        asOf: "2026-08-13",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "ems",
      assistantProfile: "accounting_client",
      externalOrganizationId: "company-42",
      message: "Въпрос",
    });

    const request = parse.mock.calls[0]?.[0] as {
      tools: Array<{ filters: { type: string; filters: unknown[] } }>;
    };
    expect(request.tools[0]?.filters.filters).toContainEqual({
      type: "and",
      filters: [
        { key: "accessLevel", type: "eq", value: "tenant" },
        { key: "tenantId", type: "eq", value: "ems" },
        { key: "documentScope", type: "eq", value: "organization" },
        { key: "organizationId", type: "eq", value: "company-42" },
      ],
    });
  });

  it("converts SDK failures to a provider availability error", async () => {
    const provider = buildProvider(vi.fn().mockRejectedValue(new Error("network failure")));

    await expect(
      provider.generate({
        tenantId: "ems",
        assistantProfile: "registered_customer",
        message: "Въпрос",
      }),
    ).rejects.toBeInstanceOf(ChatProviderUnavailableError);
  });
});
