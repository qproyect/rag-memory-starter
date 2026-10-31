import { FastifyInstance } from "fastify";
import { z } from "zod";
import { MemoryService } from "../services/memory.js";
import { AnswerService } from "../services/answer.js";
import { pool } from "../db/client.js";

const StoreMemorySchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().min(1, "Text cannot be empty"),
  metadata: z.record(z.any()).optional().default({}),
});

const QuerySchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  topK: z.number().int().positive().max(50).optional().default(5),
  metadataFilter: z.record(z.any()).optional(),
  rrfK: z.number().int().positive().optional().default(60),
});

const AnswerSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  topK: z.number().int().positive().max(10).optional().default(3),
  metadataFilter: z.record(z.any()).optional(),
});

export async function registerRoutes(
  app: FastifyInstance,
  services: {
    memoryService: MemoryService;
    answerService: AnswerService;
  }
) {
  const { memoryService, answerService } = services;

  // Health check endpoint
  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1;");
      return reply.code(200).send({
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.code(503).send({
        status: "degraded",
        database: "disconnected",
        error: (err as Error).message,
      });
    }
  });

  // POST /memories: store/upsert memory
  app.post("/memories", async (request, reply) => {
    const parsed = StoreMemorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.issues,
      });
    }

    try {
      const memory = await memoryService.storeMemory(parsed.data);
      return reply.code(201).send({
        status: "success",
        data: memory,
      });
    } catch (err) {
      request.log.error(err, "Failed to store memory");
      return reply.code(500).send({
        error: "Failed to store memory",
        message: (err as Error).message,
      });
    }
  });

  // POST /query: hybrid search with RRF
  app.post("/query", async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.issues,
      });
    }

    try {
      const results = await memoryService.hybridQuery(parsed.data);
      return reply.code(200).send({
        status: "success",
        total: results.length,
        results,
      });
    } catch (err) {
      request.log.error(err, "Failed to execute hybrid query");
      return reply.code(500).send({
        error: "Hybrid query execution failed",
        message: (err as Error).message,
      });
    }
  });

  // POST /answer: retrieve context -> prompt -> LLM -> JSON retry validation
  app.post("/answer", async (request, reply) => {
    const parsed = AnswerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.issues,
      });
    }

    try {
      const answer = await answerService.answer(parsed.data);
      return reply.code(200).send({
        status: "success",
        data: answer.result,
        context: answer.context,
        meta: {
          retried: answer.retried,
        },
      });
    } catch (err) {
      request.log.error(err, "Failed to generate answer");
      return reply.code(500).send({
        error: "Answer generation failed",
        message: (err as Error).message,
      });
    }
  });
}
