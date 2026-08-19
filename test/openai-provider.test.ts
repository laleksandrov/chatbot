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
  it("brainstorms company names on step five without claiming registry availability", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "answered",
        answer: "Ето три идеи: Кодора, Софтика и НоваЛогика. Преди избор ще проверим името в Търговския регистър.",
        asOf: "2026-08-18",
        evidenceFileIds: [],
        warnings: [],
        registrationUpdate: { activityDescription: null, companyName: null },
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart",
      assistantProfile: "registered_customer",
      message: "Предложи ми кратки и модерни имена.",
      context: {
        jurisdiction: "BG",
        registrationProgress: {
          currentStep: 5,
          completedSteps: [1, 2, 3, 4],
          activityDescription: "Разработка и поддръжка на софтуер.",
        },
      },
    });

    expect(result.status).toBe("answered");
    expect(result.sources).toEqual([]);
    expect(result.registrationUpdate).toBeUndefined();
    const request = parse.mock.calls[0]?.[0] as { instructions: string; input: string };
    expect(request.instructions).toContain("Активна е стъпката „Избор на име“");
    expect(request.instructions).toContain("Не твърди, че предложено име е свободно");
    expect(request.instructions).toContain("registrationUpdate.companyName НЕ МОЖЕ да бъде null");
    expect(JSON.parse(request.input).registrationProgress).toMatchObject({
      currentStep: 5,
      activityDescription: "Разработка и поддръжка на софтуер.",
    });
  });

  it("returns the selected company name as a structured update", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "answered",
        answer: "Записах „Кодора“ за потвърждение.",
        asOf: "2026-08-19",
        evidenceFileIds: [],
        warnings: [],
        registrationUpdate: { activityDescription: null, companyName: "Кодора" },
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart",
      assistantProfile: "registered_customer",
      message: "Избирам Кодора.",
      context: {
        registrationProgress: {
          currentStep: 5,
          completedSteps: [1, 2, 3, 4],
          activityDescription: "Разработка на софтуер.",
        },
      },
    });

    expect(result.registrationUpdate).toEqual({ companyName: "Кодора" });
  });

  it("guides the official registry name check without pretending it performed one", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "needs_clarification",
        answer: "Отворете официалната справка и потърсете „Кодора“ и близки изписвания.",
        asOf: "2026-08-19",
        evidenceFileIds: [],
        warnings: [],
        registrationUpdate: { activityDescription: null, companyName: null },
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "easystart",
      assistantProfile: "registered_customer",
      message: "Как да проверя името?",
      context: {
        registrationProgress: {
          currentStep: 6,
          completedSteps: [1, 2, 3, 4, 5],
          companyName: "Кодора",
        },
      },
    });

    const request = parse.mock.calls[0]?.[0] as { instructions: string };
    expect(request.instructions).toContain("Активна е стъпката „Проверка на името“");
    expect(request.instructions).toContain("Не твърди, че сам си извършил жива проверка");
  });

  it("guides the activity step and returns a structured full replacement without requiring evidence", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "answered",
        answer: "Добавих разработката на софтуер и запазих общата формулировка.",
        asOf: "2026-08-18",
        evidenceFileIds: [],
        warnings: [],
        registrationUpdate: {
          activityDescription: "Консултантска дейност, разработка и поддръжка на софтуер.",
          companyName: null,
        },
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart",
      assistantProfile: "registered_customer",
      message: "Добави и разработка на софтуер.",
      context: {
        jurisdiction: "BG",
        registrationProgress: {
          currentStep: 4,
          completedSteps: [1, 2, 3],
          copiedCompanyDetails: { activity: "Консултантска дейност" },
          activityDescription: "Консултантска дейност",
        },
      },
    });

    expect(result).toMatchObject({
      status: "answered",
      sources: [],
      registrationUpdate: {
        activityDescription: "Консултантска дейност, разработка и поддръжка на софтуер.",
      },
    });
    const request = parse.mock.calls[0]?.[0] as { instructions: string; input: string };
    expect(request.instructions).toContain("Активна е стъпката „Описание на дейността“");
    expect(request.instructions).toContain("целия готов текст");
    expect(JSON.parse(request.input).registrationProgress).toMatchObject({
      currentStep: 4,
      activityDescription: "Консултантска дейност",
    });
  });

  it("targets the EasyStart capabilities document for a public capability intent", async () => {
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
      tenantId: "easystart-public-client",
      assistantProfile: "public_pre_registration",
      message: "Какво прави тази платформа?",
    });

    const request = parse.mock.calls[0]?.[0] as {
      instructions: string;
      tools: Array<{ filters: unknown }>;
    };
    expect(request.instructions).toContain("Публичният обхват включва");
    expect(request.instructions).toContain("Използвай само факти");
    expect(request.instructions).toContain("Каноничните материали на EasyStart");
    expect(request.instructions).toContain("нотариални, банкови");
    expect(request.instructions).toContain("счетоводното обслужване");
    expect(request.instructions).toContain("Не прави конкретни разчети за осигурителни вноски");
    expect(request.instructions).toContain("не са пряко свързани");
    expect(request.tools[0]?.filters).toEqual({
      type: "and",
      filters: [
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "easystart" },
            { key: "documentScope", type: "eq", value: "public" },
          ],
        },
        { key: "category", type: "eq", value: "platform_capabilities" },
      ],
    });
  });

  it("targets the canonical EasyStart pricing document for platform-cost questions", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer: "Няма достатъчно данни.",
        asOf: "2026-08-16",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart",
      assistantProfile: "public_pre_registration",
      message: "Колко ще ми струва да ползвам платформата?",
    });

    const request = parse.mock.calls[0]?.[0] as {
      tools: Array<{ filters: unknown }>;
    };
    expect(request.tools[0]?.filters).toEqual({
      type: "and",
      filters: [
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "easystart" },
            { key: "documentScope", type: "eq", value: "public" },
          ],
        },
        { key: "category", type: "eq", value: "platform_pricing" },
      ],
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.answer).toContain("регистрирате безплатно");
  });

  it("uses both canonical EasyStart documents for a mixed intent", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer: "Липсва информация.",
        asOf: "2026-08-17",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "any-public-client-name",
      assistantProfile: "public_pre_registration",
      message: "Какво включва платформата и колко струва?",
    });

    const request = parse.mock.calls[0]?.[0] as { tools: Array<{ filters: unknown }> };
    expect(request.tools[0]?.filters).toEqual({
      type: "and",
      filters: [
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "tenant" },
            { key: "tenantId", type: "eq", value: "easystart" },
            { key: "documentScope", type: "eq", value: "public" },
          ],
        },
        {
          key: "category",
          type: "in",
          value: ["platform_capabilities", "platform_pricing"],
        },
      ],
    });
  });

  it("adds only global official sources to the canonical pricing document for external costs", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer: "Липсва информация.",
        asOf: "2026-08-17",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "easystart-public-client",
      assistantProfile: "public_pre_registration",
      message: "Какви разходи и държавни такси има при учредяване на ООД?",
    });

    const request = parse.mock.calls[0]?.[0] as { tools: Array<{ filters: unknown }> };
    expect(request.tools[0]?.filters).toEqual({
      type: "or",
      filters: [
        {
          type: "and",
          filters: [
            {
              type: "and",
              filters: [
                { key: "accessLevel", type: "eq", value: "tenant" },
                { key: "tenantId", type: "eq", value: "easystart" },
                { key: "documentScope", type: "eq", value: "public" },
              ],
            },
            { key: "category", type: "eq", value: "platform_pricing" },
          ],
        },
        {
          type: "and",
          filters: [
            { key: "accessLevel", type: "eq", value: "global" },
            { key: "sourceType", type: "in", value: ["institutional", "legislation"] },
          ],
        },
      ],
    });
  });

  it.each([
    "Колко осигуровки ще плащам?",
    "Какъв данък дължа по тази конкретна сделка?",
    "Как се осчетоводява тази фактура?",
  ])("does not search or give a partial public answer for the restricted intent: %s", async (message) => {
    const parse = vi.fn();
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart-public-client",
      assistantProfile: "public_pre_registration",
      message,
      context: { asOf: "2026-08-17" },
    });

    expect(parse).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "out_of_scope",
      asOf: "2026-08-17",
      sources: [],
      warnings: [],
    });
    expect(result.answer).toContain("безплатна регистрация");
    expect(result.answer.match(/регистрац/giu)).toHaveLength(1);
  });

  it("does not duplicate a registration invitation already present in the answer", async () => {
    const answer =
      "Можете да направите безплатна регистрация, за да получите достъп до разширения режим.";
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer,
        asOf: "2026-08-17",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart",
      assistantProfile: "public_pre_registration",
      message: "Какво прави тази платформа?",
    });

    expect(result.answer).toBe(answer);
    expect(result.answer.match(/регистрац/giu)).toHaveLength(1);
  });

  it("removes internal search terminology from the user-facing answer", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer:
          "RAG retrieval не намери категория platform_capabilities във файла easystart-platform-functions.md.",
        asOf: "2026-08-17",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    const result = await provider.generate({
      tenantId: "easystart-public-client",
      assistantProfile: "public_pre_registration",
      message: "Какво мога да правя тук?",
    });

    expect(result.answer).not.toMatch(/rag|retrieval|platform_capabilities|\.md/iu);
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
      tool_choice: string;
      include: string[];
      tools: Array<{ filters: unknown; vector_store_ids: string[] }>;
    };
    expect(request.model).toBe("gpt-5.6-terra");
    expect(request.store).toBe(false);
    expect(request.tool_choice).toBe("required");
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
            { key: "tenantId", type: "eq", value: "easystart" },
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

  it("does not apply public restrictions to the registered mode and keeps public EasyStart knowledge available", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        status: "insufficient_evidence",
        answer: "Нужни са допълнителни данни.",
        asOf: "2026-08-17",
        evidenceFileIds: [],
        warnings: [],
      },
      output: [],
    });
    const provider = buildProvider(parse);

    await provider.generate({
      tenantId: "easystart-registered-client",
      assistantProfile: "registered_customer",
      message: "Колко осигуровки ще плащам?",
    });

    expect(parse).toHaveBeenCalledOnce();
    const request = parse.mock.calls[0]?.[0] as {
      tools: Array<{ filters: { type: string; filters: unknown[] } }>;
    };
    expect(request.tools[0]?.filters.filters).toContainEqual({
      type: "and",
      filters: [
        { key: "accessLevel", type: "eq", value: "tenant" },
        { key: "tenantId", type: "eq", value: "easystart" },
        { key: "documentScope", type: "eq", value: "public" },
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
