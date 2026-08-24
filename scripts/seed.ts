import { closeDb } from "../db";
import { seedDatabase } from "../lib/server/seed";

seedDatabase()
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
