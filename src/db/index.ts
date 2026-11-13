/**
 * Database connection.
 *
 *  - DATABASE_URL set to a postgres:// URL (Neon in production): node-postgres
 *    pool. Migrations run separately (`npm run db:migrate`, part of `build`).
 *  - DATABASE_URL empty (local development): embedded PGlite stored in ./.pglite,
 *    migrated automatically on first use. "memory" gives a throwaway database,
 *    and "pglite:<folder>" uses another folder (development only).
 *
 * Both are exposed with the node-postgres Drizzle type; their query APIs match.
 */
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export function isPostgresUrl(url: string | undefined): url is string {
  return !!url && /^postgres(ql)?:\/\//.test(url);
}

async function connectPostgres(url: string): Promise<DB> {
  const [{ drizzle }, { Pool }] = await Promise.all([import("drizzle-orm/node-postgres"), import("pg")]);
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzle(pool, { schema });
}

/** Opens a PGlite database and applies migrations. dataDir undefined = in memory. */
export async function connectPglite(dataDir?: string): Promise<DB> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as DB;
}

function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  // "pglite:<folder>": a separate local database, e.g. the demo data from `npm run db:seed-demo`.
  if (url.startsWith("pglite:") && !process.env.VERCEL) {
    return connectPglite(path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.slice("pglite:".length)));
  }
  if (isPostgresUrl(url)) return connectPostgres(url);
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("DATABASE_URL must be a postgres:// URL in production.");
  }
  return connectPglite(url === "memory" ? undefined : path.join(process.cwd(), ".pglite"));
}

// Cached on globalThis so dev-server hot reloads reuse one connection
// (PGlite allows only one open handle on its data directory).
const g = globalThis as unknown as { __arcsDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__arcsDb) {
    g.__arcsDb = connect().catch((err) => {
      g.__arcsDb = undefined;
      throw err;
    });
  }
  return g.__arcsDb;
}

export { schema };
