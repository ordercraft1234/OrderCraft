import type { Policy } from '@ordercraft/core'
import type { SerializedRun } from '@ordercraft/shared'
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * The tables behind FR-005 and FR-029. There is no tenant and no owner column
 * anywhere: the product has no accounts (FR-020), so a row is reachable by whoever
 * holds its address.
 *
 * Blocks are not in here. A slot row is metadata about a file that lives in
 * `packages/fixtures/slots/` or in the RPC cache; the file is the block.
 */

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const slotSource = pgEnum('slot_source', ['fixture', 'rpc'])
export const batchStatus = pgEnum('batch_status', ['running', 'done', 'cancelled', 'failed'])

/** A shelf for versions. Its name is the name of the version that opened it. */
export const policies = pgTable('policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

/**
 * One version, addressed by the SHA-256 of its canonical body. The hash is the key
 * on purpose: two people saving the same policy get the same row, and a link to a
 * version cannot go stale because the version cannot change.
 */
export const policyVersions = pgTable(
  'policy_versions',
  {
    hash: text('hash').primaryKey(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id),
    schemaVersion: integer('schema_version').notNull(),
    body: jsonb('body').$type<Policy>().notNull(),
    /** Where the version came from, when it started as a preset (FR-015). */
    presetId: text('preset_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('policy_versions_policy_id_idx').on(table.policyId),
    check('policy_versions_hash_is_sha256', sql`${table.hash} ~ '^[0-9a-f]{64}$'`),
  ],
)

/** What is known about a block on disk. `content_hash` is over the normalized file. */
export const slots = pgTable(
  'slots',
  {
    slot: bigint('slot', { mode: 'number' }).primaryKey(),
    source: slotSource('source').notNull(),
    txCount: integer('tx_count').notNull(),
    contentHash: text('content_hash').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('slots_slot_is_nonnegative', sql`${table.slot} >= 0`),
    check('slots_tx_count_is_nonnegative', sql`${table.txCount} >= 0`),
  ],
)

/**
 * One run of one version on one slot. The unique pair is what makes `POST /runs`
 * idempotent: the second request for the same pair finds this row instead of
 * computing again, and two requests racing for it cannot both insert.
 *
 * The three JSON columns are the `Run` on the wire, split where the API reads it,
 * so that a row becomes a response without a transform in between.
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyHash: text('policy_hash')
      .notNull()
      .references(() => policyVersions.hash),
    slot: bigint('slot', { mode: 'number' })
      .notNull()
      .references(() => slots.slot),
    baseline: jsonb('baseline').$type<SerializedRun['baseline']>().notNull(),
    result: jsonb('result').$type<SerializedRun['result']>().notNull(),
    metrics: jsonb('metrics').$type<SerializedRun['metrics']>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique('runs_policy_hash_slot_key').on(table.policyHash, table.slot)],
)

/**
 * A batch names its slots and counts what is done; the runs themselves are rows in
 * `runs`, reachable by `(policy_hash, slot)`, which is why cancelling loses nothing
 * (FR-017). `report` is the aggregate over finished runs and is filled by the task
 * that defines it in the kernel (T038); until then it stays null.
 */
export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyHash: text('policy_hash')
      .notNull()
      .references(() => policyVersions.hash),
    slots: jsonb('slots').$type<number[]>().notNull(),
    status: batchStatus('status').notNull().default('running'),
    doneCount: integer('done_count').notNull().default(0),
    report: jsonb('report').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [check('batches_done_count_is_nonnegative', sql`${table.doneCount} >= 0`)],
)
