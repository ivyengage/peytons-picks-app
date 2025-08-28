// lib/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Always return a PoolClient (has .release()).
 * All API routes can safely call client.release() in finally.
 */
export async function getClient() {
  return await pool.connect();
}

/**
 * Convenience helper for one-off queries (optional).
 * It grabs a client, runs the query, then releases it.
 */
export async function runQuery<T = any>(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const res = await client.query<T>(text, params);
    return res;
  } finally {
    client.release();
  }
}
