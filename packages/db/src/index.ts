import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export * from './schema.ts'
export { schema }

/**
 * Opens the runtime connection. Supabase's transaction pooler on port 6543 does not
 * support prepared statements, and on the free tier it is the one to use: direct
 * connections are few and IPv6-only. Migrations go through the session pooler with
 * `drizzle-kit migrate` and `DATABASE_URL_MIGRATE`, never through here.
 */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: !databaseUrl.includes(':6543') })
  return drizzle(client, { schema })
}

/**
 * What the services take: any Drizzle database over this schema. The API opens one
 * with `createDb`; the tests open one over PGlite, which is Postgres compiled to wasm
 * and runs the same migration, so the services are exercised against the real
 * constraints rather than a mock of them.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
