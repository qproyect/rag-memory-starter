import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createProviderFromConfig, LLMProvider } from "./providers/index.js";
import { MemoryService } from "./services/memory.js";
import { AnswerService } from "./services/answer.js";
import { registerRoutes } from "./routes/api.js";

export interface BuildAppOptions {
  provider?: LLMProvider;
  logger?: boolean;
}

export function buildApp(options?: BuildAppOptions): FastifyInstance {
  const app = fastify({
    logger: options?.logger ?? process.env.NODE_ENV !== "test",
  });

  app.register(cors, {
    origin: true,
  });

  const provider = options?.provider ?? createProviderFromConfig();
  const memoryService = new MemoryService(provider);
  const answerService = new AnswerService(memoryService, provider);

  app.register(async (instance) => {
    await registerRoutes(instance, { memoryService, answerService });
  });

  return app;
}
