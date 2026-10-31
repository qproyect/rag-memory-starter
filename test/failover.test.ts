import { describe, it, expect, vi } from "vitest";
import { FailoverProvider } from "../src/providers/failover.js";
import { LLMProvider, ChatMessage } from "../src/providers/types.js";

class TestStubProvider implements LLMProvider {
  constructor(
    public readonly name: string,
    private config?: {
      shouldFailText?: boolean;
      shouldFailChat?: boolean;
      shouldFailEmbed?: boolean;
      delayMs?: number;
      textResponse?: string;
    }
  ) {}

  async generateText(_prompt: string): Promise<string> {
    if (this.config?.delayMs) {
      await new Promise((r) => setTimeout(r, this.config!.delayMs));
    }
    if (this.config?.shouldFailText) {
      throw new Error(`Provider ${this.name} generateText failed`);
    }
    return this.config?.textResponse || `Response from ${this.name}`;
  }

  async chat(_messages: ChatMessage[]): Promise<string> {
    if (this.config?.delayMs) {
      await new Promise((r) => setTimeout(r, this.config!.delayMs));
    }
    if (this.config?.shouldFailChat) {
      throw new Error(`Provider ${this.name} chat failed`);
    }
    return this.config?.textResponse || `Chat response from ${this.name}`;
  }

  async embed(_text: string): Promise<number[]> {
    if (this.config?.delayMs) {
      await new Promise((r) => setTimeout(r, this.config!.delayMs));
    }
    if (this.config?.shouldFailEmbed) {
      throw new Error(`Provider ${this.name} embed failed`);
    }
    return [0.1, 0.2, 0.3];
  }
}

describe("FailoverProvider", () => {
  it("uses the primary provider when it succeeds", async () => {
    const primary = new TestStubProvider("primary", { textResponse: "Primary Success" });
    const secondary = new TestStubProvider("secondary", { textResponse: "Secondary" });

    const failover = new FailoverProvider({
      providers: [primary, secondary],
      timeoutMs: 1000,
    });

    const res = await failover.generateText("Hello");
    expect(res).toBe("Primary Success");
  });

  it("fails over to secondary provider when primary fails", async () => {
    const primary = new TestStubProvider("primary", { shouldFailText: true });
    const secondary = new TestStubProvider("secondary", { textResponse: "Secondary Fallback" });

    const onFailed = vi.fn();
    const failover = new FailoverProvider({
      providers: [primary, secondary],
      timeoutMs: 1000,
      onProviderFailed: onFailed,
    });

    const res = await failover.generateText("Hello");
    expect(res).toBe("Secondary Fallback");
    expect(onFailed).toHaveBeenCalledWith("primary", expect.any(Error));
  });

  it("fails over when primary provider times out", async () => {
    const primary = new TestStubProvider("primary", { delayMs: 150 });
    const secondary = new TestStubProvider("secondary", {
      textResponse: "Recovered after timeout",
    });

    const failover = new FailoverProvider({
      providers: [primary, secondary],
      timeoutMs: 50,
    });

    const res = await failover.generateText("Hello");
    expect(res).toBe("Recovered after timeout");
  });

  it("throws aggregated error when all providers fail", async () => {
    const p1 = new TestStubProvider("p1", { shouldFailText: true });
    const p2 = new TestStubProvider("p2", { shouldFailText: true });

    const failover = new FailoverProvider({
      providers: [p1, p2],
      timeoutMs: 500,
    });

    await expect(failover.generateText("Test")).rejects.toThrow(
      /All LLM providers failed in failover chain/
    );
  });

  it("fails over for embeddings correctly", async () => {
    const primary = new TestStubProvider("primary", { shouldFailEmbed: true });
    const secondary = new TestStubProvider("secondary");

    const failover = new FailoverProvider({
      providers: [primary, secondary],
      timeoutMs: 500,
    });

    const vec = await failover.embed("sample text");
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });
});
