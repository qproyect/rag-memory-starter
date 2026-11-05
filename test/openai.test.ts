import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../src/providers/openai.js";

describe("OpenAIProvider embedding dimensions", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENAI_EMBEDDING_DIMENSIONS;
  });

  it("passes default dimensions 384 and accepts returned vector of length 384", async () => {
    const mockVector: number[] = new Array(384).fill(0.123);
    let capturedBody: { dimensions?: number; input?: string; model?: string } | undefined;

    global.fetch = vi
      .fn()
      .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body && typeof init.body === "string") {
          capturedBody = JSON.parse(init.body) as {
            dimensions?: number;
            input?: string;
            model?: string;
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ embedding: mockVector }],
          }),
        } as Response;
      });

    const provider = new OpenAIProvider({ apiKey: "test-key" });
    const result = await provider.embed("hello world");

    expect(capturedBody?.dimensions).toBe(384);
    expect(result.length).toBe(384);
  });

  it("uses OPENAI_EMBEDDING_DIMENSIONS env var if set", async () => {
    process.env.OPENAI_EMBEDDING_DIMENSIONS = "512";
    const mockVector: number[] = new Array(512).fill(0.456);
    let capturedBody: { dimensions?: number; input?: string; model?: string } | undefined;

    global.fetch = vi
      .fn()
      .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body && typeof init.body === "string") {
          capturedBody = JSON.parse(init.body) as {
            dimensions?: number;
            input?: string;
            model?: string;
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ embedding: mockVector }],
          }),
        } as Response;
      });

    const provider = new OpenAIProvider({ apiKey: "test-key" });
    const result = await provider.embed("hello world");

    expect(capturedBody?.dimensions).toBe(512);
    expect(result.length).toBe(512);
  });

  it("throws clear error when returned vector length does not match expected dimensions", async () => {
    const mockVector: number[] = new Array(1536).fill(0.1);

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: mockVector }],
        }),
      } as Response;
    });

    const provider = new OpenAIProvider({ apiKey: "test-key" });
    await expect(provider.embed("hello world")).rejects.toThrow(
      "OpenAI embedding dimension mismatch: expected 384, but received 1536"
    );
  });
});
