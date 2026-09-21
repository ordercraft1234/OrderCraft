import { defineConfig } from 'drizzle-kit'

/**
 * `generate` reads the schema and needs no database, so the URL may be empty on a
 * machine that has none. `migrate` uses the session pooler — the transaction pooler
 * on 6543 cannot run DDL — and fails loudly on an empty URL rather than silently.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? '' },
  strict: true,
  verbose: true,
})
