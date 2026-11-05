#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  runEvaluations,
  formatMarkdownSummary,
  isSupportedProvider,
  SupportedProvider,
} from "./run.js";

interface CliArgs {
  provider?: SupportedProvider;
  k?: number;
  ci?: boolean;
  outPath?: string;
  allowTruncate?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      const p = args[++i];
      if (!isSupportedProvider(p)) {
        throw new Error(`Invalid --provider "${p}". Allowed values: mock, openai, ollama`);
      }
      result.provider = p;
    } else if (arg === "--k" && args[i + 1]) {
      result.k = parseInt(args[++i], 10);
    } else if (arg === "--ci") {
      result.ci = true;
    } else if (arg === "--out" && args[i + 1]) {
      result.outPath = args[++i];
    } else if (arg === "--allow-truncate") {
      result.allowTruncate = true;
    }
  }
  return result;
}

interface Thresholds {
  retrieval_hybrid_recall_at_5: number;
  retrieval_hybrid_mrr: number;
  schema_valid_rate: number;
  citation_validity: number;
  robustness_recovery: number;
}

function verifyCiThresholds(
  results: Awaited<ReturnType<typeof runEvaluations>>,
  thresholdsPath: string
): void {
  if (!fs.existsSync(thresholdsPath)) {
    throw new Error(`Thresholds file not found at ${thresholdsPath}`);
  }

  const thresholds: Thresholds = JSON.parse(fs.readFileSync(thresholdsPath, "utf8"));
  const failures: string[] = [];

  const check = (name: string, actual: number, expected: number) => {
    if (actual < expected) {
      failures.push(`${name}: actual ${actual.toFixed(4)} < threshold ${expected.toFixed(4)}`);
    }
  };

  check(
    "retrieval_hybrid_recall_at_5",
    results.retrieval.modes.hybrid.recall,
    thresholds.retrieval_hybrid_recall_at_5
  );
  check(
    "retrieval_hybrid_mrr",
    results.retrieval.modes.hybrid.mrr,
    thresholds.retrieval_hybrid_mrr
  );
  check("schema_valid_rate", results.answer.schema_valid_rate, thresholds.schema_valid_rate);
  check("citation_validity", results.answer.citation_validity, thresholds.citation_validity);
  check("robustness_recovery", results.robustness.recovery_rate, thresholds.robustness_recovery);

  if (failures.length > 0) {
    console.error("\n❌ CI Thresholds Regression Failure:\n" + failures.join("\n"));
    process.exit(1);
  } else {
    console.log("\n✅ All CI threshold regression guards passed successfully.");
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.ci && args.k !== undefined && args.k !== 5) {
      console.error(
        `\nError: CI threshold enforcement is defined for k=5, but received --k=${args.k}.`
      );
      process.exit(1);
    }

    const results = await runEvaluations({
      providerName: args.provider,
      k: args.k,
      ci: args.ci,
      allowTruncate: args.allowTruncate,
    });

    const markdown = formatMarkdownSummary(results);
    console.log(markdown);

    const outPath = args.outPath || path.resolve(process.cwd(), "evals/results/latest.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`Saved evaluation details to ${outPath}`);

    if (args.ci) {
      const thresholdsPath = path.resolve(process.cwd(), "evals/thresholds.json");
      verifyCiThresholds(results, thresholdsPath);
    }

    process.exit(0);
  } catch (error) {
    console.error("\nEval runner failed:", (error as Error).message);
    process.exit(1);
  }
}

main();
