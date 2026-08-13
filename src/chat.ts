import type { ChatProvider, ChatProviderInput, ChatProviderResult } from "./domain.js";

export class FakeChatProvider implements ChatProvider {
  async generate(input: ChatProviderInput): Promise<ChatProviderResult> {
    return {
      status: "needs_clarification",
      answer: `Получих въпроса „${input.message}“. Fake provider не изготвя фактически отговори.`,
      asOf: input.context?.asOf ?? new Date().toISOString().slice(0, 10),
      sources: [],
      warnings: ["Използван е fake provider; не е извършено търсене в базата знания."],
    };
  }
}
