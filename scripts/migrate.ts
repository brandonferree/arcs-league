/**
 * Applies migrations in ./drizzle to DATABASE_URL (Neon / any Postgres).
 * Runs as part of `npm run build`, so Vercel deploys migrate before building.
 * With no postgres:// DATABASE_URL it does nothing: the local PGlite database
 * migrates itself when the app first connects.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();

if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.log("db:migrate: no postgres:// DATABASE_URL; skipping (local PGlite migrates on startup).");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("db:migrate: migrations applied.");
} finally {
  await pool.end();
}
