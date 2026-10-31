import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";

dotenv.config();

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

async function main() {
  try {
    // Run database migrations on startup if connected
    console.log("Ensuring database migrations are up to date...");
    await runMigrations();

    const app = buildApp({ logger: true });

    await app.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);
  } catch (err) {
    console.error("Failed to start application:", err);
    process.exit(1);
  }
}

main();
