import {
  LLMProvider,
  ChatMessage,
  ChatCompletionOptions,
  generateDeterministicEmbedding,
} from "./types.js";

export class MockProvider implements LLMProvider {
  public readonly name = "mock";

  private deterministicFailCount = 0;
  private failTimes = 0;

  constructor(options?: { failTimes?: number }) {
    if (options?.failTimes) {
      this.failTimes = options.failTimes;
    }
  }

  public setFailTimes(count: number): void {
    this.failTimes = count;
    this.deterministicFailCount = 0;
  }

  async generateText(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    if (this.deterministicFailCount < this.failTimes) {
      this.deterministicFailCount++;
      throw new Error(
        `MockProvider configured transient failure (${this.deterministicFailCount}/${this.failTimes})`
      );
    }

    if (options?.jsonMode || prompt.includes("JSON")) {
      return JSON.stringify({
        answer: `Deterministic mock answer responding to context.`,
        confidence: 0.95,
        citations: ["seed-1", "seed-2"],
        summary: "Synthetic mock summary generated without external network dependencies.",
      });
    }

    return `Deterministic mock answer for prompt: ${prompt.slice(0, 50)}...`;
  }

  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    return this.generateText(lastUserMessage, options);
  }

  async embed(text: string): Promise<number[]> {
    return generateDeterministicEmbedding(text, 384);
  }
}
