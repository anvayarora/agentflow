import { closeDb } from "../db";
import { bootstrapProductionDatabase, seedDemoDatabase } from "../lib/server/seed";

(process.env.SEED_MODE === "production" ? bootstrapProductionDatabase() : seedDemoDatabase())
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
