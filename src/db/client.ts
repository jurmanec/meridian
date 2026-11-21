import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  if (!database) {
    client = postgres(url, { max: 1 });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await client?.end();
  client = undefined;
  database = undefined;
}
