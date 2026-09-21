import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The schema in `src/schema.ts` and the migrations in `drizzle/` are two statements of
 * the same thing, and only one of them reaches the database. A column added to the
 * schema without `pnpm db:generate` would typecheck, pass every test beside this one,
 * and fail on the first insert in production. So the generator is asked whether it has
 * anything to say, and the answer has to be no.
 *
 * It is asked over a copy of `drizzle/`: on a drift the generator writes the missing
 * migration, and a failing test must not leave one behind for the next commit to pick
 * up unread.
 */
describe('schema and migrations agree', () => {
  it('drizzle-kit generate finds nothing to migrate', () => {
    const packageDir = fileURLToPath(new URL('../', import.meta.url))
    // The binary is found through the package, not through `npx`: a `.cmd` shim needs
    // a shell on Windows, and a shell means the temp path goes through it unquoted.
    const bin = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')
    // Inside the package, not in the system temp dir: drizzle-kit joins `--out` onto
    // its working directory even when the path is absolute, and on Windows that
    // produces `E:\...\C:\...`. The name is ignored by git and removed below.
    const scratch = mkdtempSync(join(packageDir, '.drift-'))
    cpSync(join(packageDir, 'drizzle'), scratch, { recursive: true })

    try {
      // Flags on the command line replace the config file entirely, so the schema and
      // the dialect are repeated here rather than read from `drizzle.config.ts`.
      const run = spawnSync(
        process.execPath,
        [
          bin,
          'generate',
          '--dialect',
          'postgresql',
          '--schema',
          './src/schema.ts',
          '--out',
          `./${basename(scratch)}`,
        ],
        { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )

      expect(run.status, run.stderr).toBe(0)
      expect(readdirSync(scratch).sort()).toEqual(readdirSync(join(packageDir, 'drizzle')).sort())
      expect(`${run.stdout}${run.stderr}`).toContain('No schema changes')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 60_000)
})
