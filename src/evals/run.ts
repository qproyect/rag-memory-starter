import fs from "node:fs";
import path from "node:path";
import { pool } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { MemoryService } from "../services/memory.js";
import { AnswerService } from "../services/answer.js";
import { LLMProvider } from "../providers/types.js";
import { MockProvider } from "../providers/mock.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OllamaProvider } from "../providers/ollama.js";
import { FailoverProvider } from "../providers/failover.js";
import { recallAtK, mrr, ndcgAtK, hitRateAtK } from "./metrics.js";

export type SupportedProvider = "mock" | "openai" | "ollama";

export function isSupportedProvider(val: string): val is SupportedProvider {
  return val === "mock" || val === "openai" || val === "ollama";
}

export interface CorpusItem {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface QueryItem {
  id: string;
  query: string;
  category: "exact_keyword" | "paraphrase" | "entity_numeric" | "filtered" | "no_answer";
  relevantIds: string[];
  metadataFilter?: Record<string, unknown>;
}

export interface RetrievalMetricScores {
  recall: number;
  mrr: number;
  ndcg: number;
  hitRate: number;
  count: number;
}

export interface EvalRunOptions {
  providerName?: SupportedProvider;
  k?: number;
  ci?: boolean;
  outPath?: string;
  allowTruncate?: boolean;
}

export interface RobustnessScenarioResult {
  recovered: boolean;
  error?: string;
}

export interface EvalResults {
  timestamp: string;
  provider: string;
  k: number;
  retrieval: {
    modes: Record<"hybrid" | "vector" | "text", RetrievalMetricScores>;
    categories: Record<string, Record<"hybrid" | "vector" | "text", RetrievalMetricScores>>;
  };
  answer: {
    total_queries: number;
    answer_errors: number;
    schema_valid_rate: number;
    retry_rate: number;
    citation_validity: number;
    citation_recall: number;
    abstention_rate: number;
    is_mock: boolean;
  };
  robustness: {
    scenarios: Record<
      | "fenced_json"
      | "invalid_json_then_valid"
      | "schema_invalid_then_valid"
      | "primary_throws"
      | "primary_times_out",
      RobustnessScenarioResult
    >;
    recovery_rate: number;
  };
}

export function verifyDatabaseSafety(dbUrl: string | undefined, allowTruncate?: boolean): void {
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set. Please set DATABASE_URL to run evaluations.");
  }

  let dbName = "";
  try {
    const parsed = new URL(dbUrl);
    dbName = parsed.pathname.replace(/^\//, "");
  } catch {
    const match = dbUrl.match(/\/([^/?]+)(?:\?|$)/);
    if (match) {
      dbName = match[1];
    }
  }

  const isSafe = dbName.endsWith("_eval") || dbName.endsWith("_test") || Boolean(allowTruncate);

  if (!isSafe) {
    throw new Error(
      `SAFETY REFUSAL: DATABASE_URL points to database "${dbName}". Evaluations truncate the "memories" table! Database name must end with "_eval" or "_test", or you must pass --allow-truncate.`
    );
  }
}

export function createProvider(name?: string): LLMProvider {
  const chosen = name || process.env.PRIMARY_LLM_PROVIDER || "mock";
  if (!isSupportedProvider(chosen)) {
    throw new Error(`Invalid provider "${chosen}". Must be one of: "mock", "openai", "ollama".`);
  }

  if (chosen === "mock") {
    return new MockProvider();
  }
  if (chosen === "openai") {
    return new OpenAIProvider();
  }
  return new OllamaProvider();
}

export async function runEvaluations(options: EvalRunOptions = {}): Promise<EvalResults> {
  const k = options.k ?? 5;
  const allowTruncate = options.allowTruncate ?? false;

  verifyDatabaseSafety(process.env.DATABASE_URL, allowTruncate);

  const provider = createProvider(options.providerName);
  const memoryService = new MemoryService(provider);
  const answerService = new AnswerService(memoryService, provider);

  await runMigrations();
  await pool.query("TRUNCATE memories RESTART IDENTITY CASCADE;");

  const corpusPath = path.resolve(process.cwd(), "evals/datasets/corpus.json");
  const queriesPath = path.resolve(process.cwd(), "evals/datasets/queries.json");

  const corpus: CorpusItem[] = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const queries: QueryItem[] = JSON.parse(fs.readFileSync(queriesPath, "utf8"));

  for (const item of corpus) {
    await memoryService.storeMemory({
      id: item.id,
      text: item.text,
      metadata: item.metadata,
    });
  }

  const retrievalQueries = queries.filter((q) => q.category !== "no_answer");
  const modes: Array<"hybrid" | "vector" | "text"> = ["hybrid", "vector", "text"];

  type Accumulator = {
    recalls: number[];
    mrrs: number[];
    ndcgs: number[];
    hitRates: number[];
  };

  const modeTotals: Record<"hybrid" | "vector" | "text", Accumulator> = {
    hybrid: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
    vector: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
    text: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
  };

  const categoryTotals: Record<string, Record<"hybrid" | "vector" | "text", Accumulator>> = {};

  for (const q of retrievalQueries) {
    if (!categoryTotals[q.category]) {
      categoryTotals[q.category] = {
        hybrid: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
        vector: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
        text: { recalls: [], mrrs: [], ndcgs: [], hitRates: [] },
      };
    }

    for (const mode of modes) {
      const results = await memoryService.hybridQuery({
        query: q.query,
        topK: k,
        metadataFilter: q.metadataFilter,
        retrievalMode: mode,
      });

      const retrievedIds = results.map((r) => r.id);
      const rVal = recallAtK(retrievedIds, q.relevantIds, k);
      const mVal = mrr(retrievedIds, q.relevantIds);
      const nVal = ndcgAtK(retrievedIds, q.relevantIds, k);
      const hVal = hitRateAtK(retrievedIds, q.relevantIds, k);

      if (rVal !== null) {
        modeTotals[mode].recalls.push(rVal);
        categoryTotals[q.category][mode].recalls.push(rVal);
      }
      if (mVal !== null) {
        modeTotals[mode].mrrs.push(mVal);
        categoryTotals[q.category][mode].mrrs.push(mVal);
      }
      if (nVal !== null) {
        modeTotals[mode].ndcgs.push(nVal);
        categoryTotals[q.category][mode].ndcgs.push(nVal);
      }
      if (hVal !== null) {
        modeTotals[mode].hitRates.push(hVal);
        categoryTotals[q.category][mode].hitRates.push(hVal);
      }
    }
  }

  const average = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  const modeScores: Record<"hybrid" | "vector" | "text", RetrievalMetricScores> = {
    hybrid: {
      recall: Number(average(modeTotals.hybrid.recalls).toFixed(4)),
      mrr: Number(average(modeTotals.hybrid.mrrs).toFixed(4)),
      ndcg: Number(average(modeTotals.hybrid.ndcgs).toFixed(4)),
      hitRate: Number(average(modeTotals.hybrid.hitRates).toFixed(4)),
      count: modeTotals.hybrid.recalls.length,
    },
    vector: {
      recall: Number(average(modeTotals.vector.recalls).toFixed(4)),
      mrr: Number(average(modeTotals.vector.mrrs).toFixed(4)),
      ndcg: Number(average(modeTotals.vector.ndcgs).toFixed(4)),
      hitRate: Number(average(modeTotals.vector.hitRates).toFixed(4)),
      count: modeTotals.vector.recalls.length,
    },
    text: {
      recall: Number(average(modeTotals.text.recalls).toFixed(4)),
      mrr: Number(average(modeTotals.text.mrrs).toFixed(4)),
      ndcg: Number(average(modeTotals.text.ndcgs).toFixed(4)),
      hitRate: Number(average(modeTotals.text.hitRates).toFixed(4)),
      count: modeTotals.text.recalls.length,
    },
  };

  const categoryScores: Record<
    string,
    Record<"hybrid" | "vector" | "text", RetrievalMetricScores>
  > = {};

  for (const [cat, modeObj] of Object.entries(categoryTotals)) {
    categoryScores[cat] = {
      hybrid: {
        recall: Number(average(modeObj.hybrid.recalls).toFixed(4)),
        mrr: Number(average(modeObj.hybrid.mrrs).toFixed(4)),
        ndcg: Number(average(modeObj.hybrid.ndcgs).toFixed(4)),
        hitRate: Number(average(modeObj.hybrid.hitRates).toFixed(4)),
        count: modeObj.hybrid.recalls.length,
      },
      vector: {
        recall: Number(average(modeObj.vector.recalls).toFixed(4)),
        mrr: Number(average(modeObj.vector.mrrs).toFixed(4)),
        ndcg: Number(average(modeObj.vector.ndcgs).toFixed(4)),
        hitRate: Number(average(modeObj.vector.hitRates).toFixed(4)),
        count: modeObj.vector.recalls.length,
      },
      text: {
        recall: Number(average(modeObj.text.recalls).toFixed(4)),
        mrr: Number(average(modeObj.text.mrrs).toFixed(4)),
        ndcg: Number(average(modeObj.text.ndcgs).toFixed(4)),
        hitRate: Number(average(modeObj.text.hitRates).toFixed(4)),
        count: modeObj.text.recalls.length,
      },
    };
  }

  let schemaValidCount = 0;
  let retryCount = 0;
  let answerErrors = 0;
  const citationValidities: number[] = [];
  const citationRecalls: number[] = [];
  let noAnswerCount = 0;
  let abstainedCount = 0;

  for (const q of queries) {
    try {
      const response = await answerService.answer({
        query: q.query,
        metadataFilter: q.metadataFilter,
      });

      schemaValidCount++;
      if (response.retried) {
        retryCount++;
      }

      const cited = response.result.citations || [];
      const retrievedIds = new Set(response.context.map((c) => c.id));

      if (cited.length === 0) {
        citationValidities.push(1.0);
      } else {
        const validHits = cited.filter((id) => retrievedIds.has(id)).length;
        citationValidities.push(validHits / cited.length);
      }

      if (q.relevantIds.length > 0) {
        const relevantSet = new Set(q.relevantIds);
        const recalled = cited.filter((id) => relevantSet.has(id)).length;
        citationRecalls.push(recalled / q.relevantIds.length);
      }

      if (q.category === "no_answer") {
        noAnswerCount++;
        if (response.result.confidence < 0.5) {
          abstainedCount++;
        }
      }
    } catch {
      answerErrors++;
    }
  }

  const schemaValidRate = Number((schemaValidCount / queries.length).toFixed(4));
  const retryRate = Number((retryCount / queries.length).toFixed(4));
  const citationValidityRate = Number(average(citationValidities).toFixed(4));
  const citationRecallRate = Number(average(citationRecalls).toFixed(4));
  const abstentionRate =
    noAnswerCount > 0 ? Number((abstainedCount / noAnswerCount).toFixed(4)) : 0;

  const robustnessResults = await runRobustnessEvaluation(memoryService);

  const results: EvalResults = {
    timestamp: new Date().toISOString(),
    provider: provider.name,
    k,
    retrieval: {
      modes: modeScores,
      categories: categoryScores,
    },
    answer: {
      total_queries: queries.length,
      answer_errors: answerErrors,
      schema_valid_rate: schemaValidRate,
      retry_rate: retryRate,
      citation_validity: citationValidityRate,
      citation_recall: citationRecallRate,
      abstention_rate: abstentionRate,
      is_mock: provider.name === "mock",
    },
    robustness: robustnessResults,
  };

  return results;
}

export async function runRobustnessEvaluation(
  memoryService: MemoryService
): Promise<EvalResults["robustness"]> {
  const scenarios: EvalResults["robustness"]["scenarios"] = {
    fenced_json: { recovered: false },
    invalid_json_then_valid: { recovered: false },
    schema_invalid_then_valid: { recovered: false },
    primary_throws: { recovered: false },
    primary_times_out: { recovered: false },
  };

  // Scenario 1: Fenced JSON
  try {
    const fencedDouble: LLMProvider = {
      name: "fenced-double",
      embed: async (t) => new MockProvider().embed(t),
      chat: async () => "",
      generateText: async () =>
        "```json\n" +
        JSON.stringify({
          answer: "Grounded answer from fenced markdown block.",
          confidence: 0.9,
          citations: [],
        }) +
        "\n```",
    };
    const ansSvc = new AnswerService(memoryService, fencedDouble);
    const res = await ansSvc.answer({ query: "Test fenced JSON" });
    if (res.result.answer.includes("Grounded answer")) {
      scenarios.fenced_json.recovered = true;
    }
  } catch (err) {
    scenarios.fenced_json.error = (err as Error).message;
  }

  // Scenario 2: Invalid JSON on attempt 1, valid on retry
  try {
    let call = 0;
    const invalidJsonDouble: LLMProvider = {
      name: "invalid-json-double",
      embed: async (t) => new MockProvider().embed(t),
      chat: async () => "",
      generateText: async () => {
        call++;
        if (call === 1) {
          return "Plain text preamble without any json object";
        }
        return JSON.stringify({
          answer: "Recovered valid json answer on retry.",
          confidence: 0.85,
          citations: [],
        });
      },
    };
    const ansSvc = new AnswerService(memoryService, invalidJsonDouble);
    const res = await ansSvc.answer({ query: "Test invalid JSON retry" });
    if (res.retried && res.result.answer.includes("Recovered")) {
      scenarios.invalid_json_then_valid.recovered = true;
    }
  } catch (err) {
    scenarios.invalid_json_then_valid.error = (err as Error).message;
  }

  // Scenario 3: Schema invalid on attempt 1, valid on retry
  try {
    let call = 0;
    const schemaInvalidDouble: LLMProvider = {
      name: "schema-invalid-double",
      embed: async (t) => new MockProvider().embed(t),
      chat: async () => "",
      generateText: async () => {
        call++;
        if (call === 1) {
          return JSON.stringify({
            answer: "",
            confidence: 1.5,
          });
        }
        return JSON.stringify({
          answer: "Properly repaired schema answer on retry.",
          confidence: 0.92,
          citations: [],
        });
      },
    };
    const ansSvc = new AnswerService(memoryService, schemaInvalidDouble);
    const res = await ansSvc.answer({ query: "Test schema invalid retry" });
    if (res.retried && res.result.answer.includes("Properly repaired")) {
      scenarios.schema_invalid_then_valid.recovered = true;
    }
  } catch (err) {
    scenarios.schema_invalid_then_valid.error = (err as Error).message;
  }

  // Scenario 4: Primary provider throws immediate error
  try {
    const failingPrimary: LLMProvider = {
      name: "failing-primary",
      embed: async (t) => new MockProvider().embed(t),
      chat: async () => {
        throw new Error("Simulated primary provider fatal 500 error");
      },
      generateText: async () => {
        throw new Error("Simulated primary provider fatal 500 error");
      },
    };
    const healthySecondary = new MockProvider();
    const failover = new FailoverProvider({
      providers: [failingPrimary, healthySecondary],
      timeoutMs: 1000,
    });
    const ansSvc = new AnswerService(memoryService, failover);
    const res = await ansSvc.answer({ query: "Test primary throws failover" });
    if (res.result.answer.length > 0) {
      scenarios.primary_throws.recovered = true;
    }
  } catch (err) {
    scenarios.primary_throws.error = (err as Error).message;
  }

  // Scenario 5: Primary provider times out
  try {
    const hangingPrimary: LLMProvider = {
      name: "hanging-primary",
      embed: async (t) => new MockProvider().embed(t),
      chat: async () => new Promise(() => {}),
      generateText: async () => new Promise(() => {}),
    };
    const healthySecondary = new MockProvider();
    const failover = new FailoverProvider({
      providers: [hangingPrimary, healthySecondary],
      timeoutMs: 50,
    });
    const ansSvc = new AnswerService(memoryService, failover);
    const res = await ansSvc.answer({ query: "Test primary timeout failover" });
    if (res.result.answer.length > 0) {
      scenarios.primary_times_out.recovered = true;
    }
  } catch (err) {
    scenarios.primary_times_out.error = (err as Error).message;
  }

  const scenarioKeys = Object.keys(scenarios) as Array<keyof typeof scenarios>;
  const recoveredCount = scenarioKeys.filter((k) => scenarios[k].recovered).length;
  const recovery_rate = Number((recoveredCount / scenarioKeys.length).toFixed(4));

  return {
    scenarios,
    recovery_rate,
  };
}

export function formatMarkdownSummary(results: EvalResults): string {
  const { retrieval, answer, robustness, k, provider } = results;

  let md = `# Evaluation Report\n\n`;
  md += `**Timestamp:** ${results.timestamp} | **Provider:** \`${provider}\` | **K:** ${k}\n\n`;

  md += `## 1. Retrieval Performance (Overall at K=${k})\n\n`;
  md += `| Retrieval Mode | Recall@${k} | MRR | NDCG@${k} | HitRate@${k} | Queries |\n`;
  md += `|---|---|---|---|---|---|\n`;
  md += `| **Hybrid (RRF)** | ${retrieval.modes.hybrid.recall.toFixed(4)} | ${retrieval.modes.hybrid.mrr.toFixed(4)} | ${retrieval.modes.hybrid.ndcg.toFixed(4)} | ${retrieval.modes.hybrid.hitRate.toFixed(4)} | ${retrieval.modes.hybrid.count} |\n`;
  md += `| **Vector Only**  | ${retrieval.modes.vector.recall.toFixed(4)} | ${retrieval.modes.vector.mrr.toFixed(4)} | ${retrieval.modes.vector.ndcg.toFixed(4)} | ${retrieval.modes.vector.hitRate.toFixed(4)} | ${retrieval.modes.vector.count} |\n`;
  md += `| **Text Only**    | ${retrieval.modes.text.recall.toFixed(4)} | ${retrieval.modes.text.mrr.toFixed(4)} | ${retrieval.modes.text.ndcg.toFixed(4)} | ${retrieval.modes.text.hitRate.toFixed(4)} | ${retrieval.modes.text.count} |\n\n`;

  md += `## 2. Retrieval Performance by Query Category\n\n`;
  md += `| Category | Mode | Recall@${k} | MRR | NDCG@${k} | HitRate@${k} |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const [cat, modeObj] of Object.entries(retrieval.categories)) {
    md += `| \`${cat}\` | Hybrid | ${modeObj.hybrid.recall.toFixed(4)} | ${modeObj.hybrid.mrr.toFixed(4)} | ${modeObj.hybrid.ndcg.toFixed(4)} | ${modeObj.hybrid.hitRate.toFixed(4)} |\n`;
    md += `| \`${cat}\` | Vector | ${modeObj.vector.recall.toFixed(4)} | ${modeObj.vector.mrr.toFixed(4)} | ${modeObj.vector.ndcg.toFixed(4)} | ${modeObj.vector.hitRate.toFixed(4)} |\n`;
    md += `| \`${cat}\` | Text   | ${modeObj.text.recall.toFixed(4)} | ${modeObj.text.mrr.toFixed(4)} | ${modeObj.text.ndcg.toFixed(4)} | ${modeObj.text.hitRate.toFixed(4)} |\n`;
  }

  md += `\n## 3. Answer Quality & Reliability\n\n`;
  md += `| Metric | Score | Notes |\n`;
  md += `|---|---|---|\n`;
  md += `| Schema Valid Rate | ${(answer.schema_valid_rate * 100).toFixed(1)}% | Valid JSON conforming to Zod schema |\n`;
  md += `| Self-Correction Retry Rate | ${(answer.retry_rate * 100).toFixed(1)}% | Queries requiring retry prompt |\n`;
  md += `| Citation Validity | ${(answer.citation_validity * 100).toFixed(1)}% | Cited IDs present in retrieved context |\n`;
  md += `| Citation Recall | ${(answer.citation_recall * 100).toFixed(1)}% | Relevant IDs cited by answer |\n`;
  md += `| Abstention Rate (\`no_answer\`) | ${(answer.abstention_rate * 100).toFixed(1)}% | ${
    answer.is_mock ? "*(Not meaningful with mock provider)*" : "Confidence < 0.5 on unanswerable"
  } |\n`;
  md += `| Answer Errors | ${answer.answer_errors} | Exceptions during answer generation |\n\n`;

  md += `## 4. Provider Layer Robustness\n\n`;
  md += `| Scenario | Recovered | Details |\n`;
  md += `|---|---|---|\n`;
  md += `| Markdown Code Fences | ${robustness.scenarios.fenced_json.recovered ? "✅ Yes" : `❌ No: ${robustness.scenarios.fenced_json.error}`} | Strips \`\`\`json wrappers |\n`;
  md += `| Invalid JSON -> Self-Correction | ${robustness.scenarios.invalid_json_then_valid.recovered ? "✅ Yes" : `❌ No: ${robustness.scenarios.invalid_json_then_valid.error}`} | Recovers on error feedback retry |\n`;
  md += `| Schema Violation -> Self-Correction | ${robustness.scenarios.schema_invalid_then_valid.recovered ? "✅ Yes" : `❌ No: ${robustness.scenarios.schema_invalid_then_valid.error}`} | Retries with Zod validation message |\n`;
  md += `| Primary Provider Throws | ${robustness.scenarios.primary_throws.recovered ? "✅ Yes" : `❌ No: ${robustness.scenarios.primary_throws.error}`} | FailoverProvider delegates to backup |\n`;
  md += `| Primary Provider Times Out | ${robustness.scenarios.primary_times_out.recovered ? "✅ Yes" : `❌ No: ${robustness.scenarios.primary_times_out.error}`} | Fallback triggered upon timeout |\n`;
  md += `| **Overall Recovery Rate** | **${(robustness.recovery_rate * 100).toFixed(1)}%** | All resilience patterns |\n`;

  return md;
}
