import {
  type Policy,
  type SlotBundle,
  apply,
  extractedValue,
  findSandwiches,
  runMetrics,
  tripleOutcome,
} from '@ordercraft/core'
import { type Db, policyVersions, runs } from '@ordercraft/db'
import {
  type CreateRunRequest,
  type SerializedRun,
  serializeExtractedValue,
  serializeOrdering,
} from '@ordercraft/shared'
import { and, eq } from 'drizzle-orm'
import { notFound } from '../errors.ts'
import type { SlotStore } from './slots.ts'

type RunRow = typeof runs.$inferSelect

/**
 * `POST /runs` (FR-029): one run per `(policyHash, slot)`. The pair is looked up
 * first, and if two requests for a new pair race past that lookup, the unique
 * constraint lets exactly one insert through and the other reads what it inserted.
 * Nothing is computed twice on purpose, and nothing is computed twice by accident
 * either, except in that race — and the kernel is deterministic (SC-002), so even
 * then the two results are the same and one of them is simply discarded.
 */
export async function createRun(
  db: Db,
  store: SlotStore,
  request: CreateRunRequest,
): Promise<SerializedRun> {
  const existing = await findRun(db, request)
  if (existing !== undefined) return toWire(existing)

  const version = await db.query.policyVersions.findFirst({
    where: eq(policyVersions.hash, request.hash),
  })
  if (version === undefined) throw notFound('policy version', { hash: request.hash })

  const bundle = await store.read(db, request.slot)
  const computed = compute(version.body, bundle)

  const [inserted] = await db
    .insert(runs)
    .values({ policyHash: request.hash, slot: request.slot, ...computed })
    .onConflictDoNothing()
    .returning()
  if (inserted !== undefined) return toWire(inserted)

  const winner = await findRun(db, request)
  if (winner === undefined) throw new Error(`run (${request.hash}, ${request.slot}) vanished`)

  return toWire(winner)
}

export async function getRun(db: Db, id: string): Promise<SerializedRun> {
  const row = await db.query.runs.findFirst({ where: eq(runs.id, id) })
  if (row === undefined) throw notFound('run', { id })

  return toWire(row)
}

/**
 * The whole data flow of one run, in the order the plan draws it: detector on the
 * recorded block, policy applied, each triple judged against the new order, metrics.
 * Everything here is the kernel; this function only holds the pieces together.
 */
function compute(
  policy: Policy,
  bundle: SlotBundle,
): Pick<RunRow, 'baseline' | 'result' | 'metrics'> {
  const sandwiches = findSandwiches(bundle)
  const ordering = apply(policy, bundle)

  return {
    baseline: {
      attacks: sandwiches.map((sandwich) => ({
        ...sandwich,
        extracted: serializeExtractedValue(extractedValue(bundle, sandwich)),
      })),
    },
    result: {
      ordering: serializeOrdering(ordering),
      outcomes: sandwiches.map((sandwich) => tripleOutcome(sandwich, ordering)),
    },
    metrics: runMetrics(bundle, ordering),
  }
}

function findRun(db: Db, request: CreateRunRequest): Promise<RunRow | undefined> {
  return db.query.runs.findFirst({
    where: and(eq(runs.policyHash, request.hash), eq(runs.slot, request.slot)),
  })
}

function toWire(row: RunRow): SerializedRun {
  return {
    id: row.id,
    policyHash: row.policyHash,
    slot: row.slot,
    baseline: row.baseline,
    result: row.result,
    metrics: row.metrics,
    createdAt: row.createdAt.toISOString(),
  }
}
