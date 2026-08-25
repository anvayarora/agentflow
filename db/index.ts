import postgres, { type Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type AppDb = PostgresJsDatabase<typeof schema>;

let client: Sql | undefined;
let database: AppDb | undefined;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): AppDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL-backed commerce operations.");
  if (!database) {
    // Vercel can fan out many short-lived function instances while the Aiven
    // free tier has a small connection budget. Keep one bounded connection per
    // instance so a browser loop cannot exhaust the database.
    client = postgres(url, { prepare: false, max: 1, idle_timeout: 20, max_lifetime: 300, connect_timeout: 10 });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDb() {
  if (client) await client.end({ timeout: 2 });
  client = undefined;
  database = undefined;
}
