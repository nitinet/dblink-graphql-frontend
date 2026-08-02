import 'reflect-metadata';
import type pg from 'pg';

// Load local Postgres credentials from .env (DB_URL) when present; falls back
// to individual PG* vars/defaults in pgConfig below. Absent in CI
// environments that inject PG* vars directly — that's fine.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on process.env as already populated
}

/** Shared Postgres pool config for integration tests. */
export const pgConfig: pg.PoolConfig = process.env.DB_URL
  ? { connectionString: process.env.DB_URL, max: 2, idleTimeoutMillis: 1000 }
  : {
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? 'postgres',
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? 'postgres',
      max: 2,
      idleTimeoutMillis: 1000
    };
