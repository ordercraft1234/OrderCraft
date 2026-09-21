import { PGlite } from '@electric-sql/pglite'
import { POLICY_SCHEMA_VERSION, type Policy, policyHash } from '@ordercraft/core'
import { runSchema } from '@ordercraft/shared'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Db, batches, policies, policyVersions, runs, schema, slots } from '../src/index.ts'
import { migrationSql } from '../src/migrations.ts'

/**
 * The migration is applied to a real Postgres — PGlite is Postgres compiled to wasm —
 * and what is checked is what the database then accepts and refuses, not what the SQL
 * file says. The API's idempotency (M2's third criterion) rests on the unique pair in
 * `runs`, and a constraint is only as good as the engine that enforces it.
 *
 * What this does not prove: Supabase is not PGlite. The DDL is the same; the first
 * place the difference is measured is the deploy in T035.
 */

const POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'bump everything',
  steps: [{ kind: 'speedBump', delayMs: 100, appliesTo: { match: 'all' } }],
}
const HASH = policyHash(POLICY)
const SLOT = 445553238

let client: PGlite
let db: Db

beforeAll(async () => {
  client = await PGlite.create()
  await client.exec(migrationSql())
  db = drizzle(client, { schema })
}, 60_000)

afterAll(async () => {
  await client?.close()
})

/** The Postgres error code, so the test does not depend on the wording. */
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (cause) {
    const error = cause as { code?: string; cause?: { code?: string } }
    return error.code ?? error.cause?.code ?? `no code: ${String(cause)}`
  }

  return 'no error'
}

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'
const INVALID_TEXT_REPRESENTATION = '22P02'

describe('policies and versions', () => {
  it('a version hangs on a shelf and is addressed by its hash', async () => {
    const [shelf] = await db.insert(policies).values({ name: POLICY.name }).returning()
    if (shelf === undefined) throw new Error('no shelf')

    await db.insert(policyVersions).values({
      hash: HASH,
      policyId: shelf.id,
      schemaVersion: POLICY.schemaVersion,
      body: POLICY,
    })

    const found = await db.query.policyVersions.findFirst({
      where: eq(policyVersions.hash, HASH),
    })
    expect(found?.body).toEqual(POLICY)
    expect(found?.presetId).toBeNull()
    expect(found?.createdAt).toBeInstanceOf(Date)
  })

  it('the same hash cannot be stored twice', async () => {
    const shelf = await db.query.policies.findFirst()
    if (shelf === undefined) throw new Error('no shelf')

    const code = await codeOf(
      db.insert(policyVersions).values({
        hash: HASH,
        policyId: shelf.id,
        schemaVersion: 1,
        body: POLICY,
      }),
    )
    expect(code).toBe(UNIQUE_VIOLATION)
  })

  it('a hash that is not 64 hex characters is refused by the database itself', async () => {
    const shelf = await db.query.policies.findFirst()
    if (shelf === undefined) throw new Error('no shelf')

    const code = await codeOf(
      db.insert(policyVersions).values({
        hash: HASH.toUpperCase(),
        policyId: shelf.id,
        schemaVersion: 1,
        body: POLICY,
      }),
    )
    expect(code).toBe(CHECK_VIOLATION)
  })

  it('a version needs a shelf that exists', async () => {
    const code = await codeOf(
      db.insert(policyVersions).values({
        hash: policyHash({ ...POLICY, name: 'orphan' }),
        policyId: '00000000-0000-4000-8000-000000000000',
        schemaVersion: 1,
        body: POLICY,
      }),
    )
    expect(code).toBe(FOREIGN_KEY_VIOLATION)
  })
})

describe('slots', () => {
  it('records a block on disk and refuses a negative one', async () => {
    await db.insert(slots).values({
      slot: SLOT,
      source: 'fixture',
      txCount: 1422,
      contentHash: 'a'.repeat(64),
    })

    const found = await db.query.slots.findFirst({ where: eq(slots.slot, SLOT) })
    expect(found?.slot).toBe(SLOT)
    expect(typeof found?.slot).toBe('number')

    const code = await codeOf(
      db.insert(slots).values({ slot: -1, source: 'rpc', txCount: 0, contentHash: 'b' }),
    )
    expect(code).toBe(CHECK_VIOLATION)
  })

  it('knows two sources and no other', async () => {
    const code = await codeOf(
      db.insert(slots).values({
        slot: SLOT + 1,
        // The enum is the database's, so the type has to be defeated to test it.
        source: 'cache' as 'rpc',
        txCount: 0,
        contentHash: 'c',
      }),
    )
    expect(code).toBe(INVALID_TEXT_REPRESENTATION)
  })
})

describe('runs — one per (policy_hash, slot)', () => {
  const run = {
    policyHash: HASH,
    slot: SLOT,
    baseline: { attacks: [] },
    result: {
      ordering: { slot: SLOT, policyHash: HASH, included: [], excluded: [] },
      outcomes: [],
    },
    metrics: {
      recorded: 0,
      included: 0,
      deferred: 0,
      dropped: 0,
      moved: 0,
      delayed: 0,
      reorderedPerMille: 0,
      addedDelayMs: { p10: 0, p50: 0, p90: 0, p95: 0, max: 0 },
    },
  }

  it('stores a run and hands it back in the shape the API answers with', async () => {
    const [stored] = await db.insert(runs).values(run).returning()
    if (stored === undefined) throw new Error('no run')

    const parsed = runSchema.parse({ ...stored, createdAt: stored.createdAt.toISOString() })
    expect(parsed.policyHash).toBe(HASH)
    expect(parsed.slot).toBe(SLOT)
    expect(parsed.result.ordering.slot).toBe(SLOT)
  })

  it('refuses a second run for the same pair', async () => {
    expect(await codeOf(db.insert(runs).values(run))).toBe(UNIQUE_VIOLATION)
  })

  it('inserting on conflict does nothing and the first run is what remains', async () => {
    const inserted = await db.insert(runs).values(run).onConflictDoNothing().returning()
    expect(inserted).toEqual([])

    const all = await db.query.runs.findMany({ where: eq(runs.policyHash, HASH) })
    expect(all).toHaveLength(1)
  })

  it('needs a version and a slot that exist', async () => {
    const unknownHash = policyHash({ ...POLICY, name: 'never saved' })
    expect(await codeOf(db.insert(runs).values({ ...run, policyHash: unknownHash }))).toBe(
      FOREIGN_KEY_VIOLATION,
    )
    expect(await codeOf(db.insert(runs).values({ ...run, slot: SLOT + 1 }))).toBe(
      FOREIGN_KEY_VIOLATION,
    )
  })
})

describe('batches', () => {
  it('starts running with nothing done and no report', async () => {
    const [batch] = await db
      .insert(batches)
      .values({ policyHash: HASH, slots: [SLOT, SLOT + 1] })
      .returning()

    expect(batch?.status).toBe('running')
    expect(batch?.doneCount).toBe(0)
    expect(batch?.report).toBeNull()
    expect(batch?.slots).toEqual([SLOT, SLOT + 1])
  })

  it('knows four states and no other', async () => {
    const code = await codeOf(
      db.insert(batches).values({
        policyHash: HASH,
        slots: [SLOT],
        status: 'paused' as 'running',
      }),
    )
    expect(code).toBe(INVALID_TEXT_REPRESENTATION)
  })
})
