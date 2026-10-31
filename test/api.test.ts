import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { MockProvider } from "../src/providers/mock.js";
import { pool } from "../src/db/client.js";

describe("Fastify API Endpoints", () => {
  const provider = new MockProvider();
  const app = buildApp({ provider, logger: false });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns healthy status when db responds", async () => {
    vi.spyOn(pool, "query").mockResolvedValueOnce({ rows: [{ 1: 1 }] } as any);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");
  });

  it("POST /memories validates request body and returns 400 on invalid input", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        // missing text
        metadata: { category: "cooking" },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Validation failed");
  });

  it("POST /query validates input payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/query",
      payload: {
        // missing query
        topK: -5,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("POST /answer validates input query", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/answer",
      payload: {
        // empty query
        query: "",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
