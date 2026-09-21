import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Every migration in order, as one script. For tests that stand up a database from
 * nothing — PGlite here, and again in the API — so that the schema they run against
 * is the one `drizzle-kit migrate` would produce and not a hand-written twin of it.
 */
export function migrationSql(): string {
  const dir = fileURLToPath(new URL('../drizzle/', import.meta.url))

  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`${dir}${name}`, 'utf8'))
    .join('\n')
}
