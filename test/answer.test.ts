import { describe, it, expect, vi } from "vitest";
import { AnswerService } from "../src/services/answer.js";
import { MemoryService } from "../src/services/memory.js";
import { LLMProvider } from "../src/providers/types.js";

describe("AnswerService with Zod Schema Validation & Retry", () => {
  const mockMemoryService = {
    hybridQuery: vi.fn().mockResolvedValue([
      {
        id: "mem-1",
        text: "Sous-vide cooking uses precise temperature-controlled water baths.",
        metadata: { category: "cooking" },
        score: 0.03,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
  } as unknown as MemoryService;

  it("successfully parses valid JSON matching schema on first attempt", async () => {
    const validJsonOutput = JSON.stringify({
      answer: "Sous-vide cooking is a water bath method.",
      confidence: 0.98,
      citations: ["mem-1"],
      summary: "Even doneness technique.",
    });

    const mockProvider: LLMProvider = {
      name: "mock",
      generateText: vi.fn().mockResolvedValue(validJsonOutput),
      chat: vi.fn(),
      embed: vi.fn(),
    };

    const service = new AnswerService(mockMemoryService, mockProvider);
    const response = await service.answer({ query: "What is sous-vide?" });

    expect(response.retried).toBe(false);
    expect(response.result.answer).toBe("Sous-vide cooking is a water bath method.");
    expect(response.result.confidence).toBe(0.98);
    expect(response.result.citations).toEqual(["mem-1"]);
    expect(mockProvider.generateText).toHaveBeenCalledTimes(1);
  });

  it("handles markdown code block wrappers around valid JSON", async () => {
    const wrappedJson =
      "```json\n" +
      JSON.stringify({
        answer: "Sous-vide cooking is precise.",
        confidence: 0.9,
        citations: ["mem-1"],
      }) +
      "\n```";

    const mockProvider: LLMProvider = {
      name: "mock",
      generateText: vi.fn().mockResolvedValue(wrappedJson),
      chat: vi.fn(),
      embed: vi.fn(),
    };

    const service = new AnswerService(mockMemoryService, mockProvider);
    const response = await service.answer({ query: "What is sous-vide?" });

    expect(response.retried).toBe(false);
    expect(response.result.answer).toBe("Sous-vide cooking is precise.");
  });

  it("retries once when first response is invalid JSON, and succeeds on second attempt", async () => {
    const invalidFirstResponse = "This is not JSON at all, just plain text.";
    const validSecondResponse = JSON.stringify({
      answer: "Valid structured answer recovered on retry.",
      confidence: 0.85,
      citations: ["mem-1"],
      summary: "Recovered successfully.",
    });

    const generateTextMock = vi
      .fn()
      .mockResolvedValueOnce(invalidFirstResponse)
      .mockResolvedValueOnce(validSecondResponse);

    const mockProvider: LLMProvider = {
      name: "mock",
      generateText: generateTextMock,
      chat: vi.fn(),
      embed: vi.fn(),
    };

    const service = new AnswerService(mockMemoryService, mockProvider);
    const response = await service.answer({ query: "What is sous-vide?" });

    expect(response.retried).toBe(true);
    expect(response.result.answer).toBe("Valid structured answer recovered on retry.");
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    // Verify retry prompt contained error context
    const retryPromptCall = generateTextMock.mock.calls[1][0];
    expect(retryPromptCall).toContain("CRITICAL FIX REQUIRED");
  });

  it("retries once when schema validation fails (e.g. invalid type or missing required field)", async () => {
    const schemaInvalidFirst = JSON.stringify({
      answer: "", // empty answer violates min(1)
      confidence: 1.5, // exceeds 1.0
    });
    const validSecond = JSON.stringify({
      answer: "Corrected answer",
      confidence: 0.9,
      citations: [],
    });

    const generateTextMock = vi
      .fn()
      .mockResolvedValueOnce(schemaInvalidFirst)
      .mockResolvedValueOnce(validSecond);

    const mockProvider: LLMProvider = {
      name: "mock",
      generateText: generateTextMock,
      chat: vi.fn(),
      embed: vi.fn(),
    };

    const service = new AnswerService(mockMemoryService, mockProvider);
    const response = await service.answer({ query: "What is sous-vide?" });

    expect(response.retried).toBe(true);
    expect(response.result.answer).toBe("Corrected answer");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("throws descriptive error when retry also fails", async () => {
    const invalidText = "Still not valid json!";

    const mockProvider: LLMProvider = {
      name: "mock",
      generateText: vi.fn().mockResolvedValue(invalidText),
      chat: vi.fn(),
      embed: vi.fn(),
    };

    const service = new AnswerService(mockMemoryService, mockProvider);
    await expect(service.answer({ query: "What is sous-vide?" })).rejects.toThrow(
      /Failed to obtain valid structured answer after retry/
    );
  });
});
