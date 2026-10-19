import {
  type Ordering,
  type Policy,
  type SlotBundle,
  type TripleOutcome,
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
  hydrateOrdering,
  serializeExtractedValue,
  serializeOrdering,
} from '@ordercraft/shared'
import { and, eq } from 'drizzle-orm'
import { notFound } from '../errors.ts'
import type { Phases } from './phases.ts'
import type { SlotStore } from './slots.ts'

type RunRow = typeof runs.$inferSelect

/** A stored run with the kernel values it was built from, for whoever aggregates it. */
export interface SlotRun {
  row: RunRow
  bundle: SlotBundle
  ordering: Ordering
  outcomes: TripleOutcome[]
}

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

  return toWire((await runSlot(db, store, version, request.slot)).row)
}

/**
 * The run of `version` on `slot`, computed and stored if it is not stored yet, with the
 * kernel's ordering and outcomes beside the row. A batch needs those to summarise the run
 * (`batchEntry` reads arrival times off the bundle), and when the run already exists they
 * are rebuilt from the row rather than recomputed — so what a batch counts is exactly the
 * run anyone can open by `(hash, slot)`, and a batch over runs that exist computes nothing.
 *
 * `phases`, when given, collects where the time went: reading the slot, looking the run
 * up, the kernel, the insert.
 */
export async function runSlot(
  db: Db,
  store: SlotStore,
  version: { hash: string; body: Policy },
  slot: number,
  phases?: Phases,
): Promise<SlotRun> {
  const time = <T>(phase: string, work: () => T | Promise<T>): Promise<T> =>
    phases === undefined ? Promise.resolve(work()) : phases.time(phase, work)

  const bundle = await time('read', () => store.read(db, slot))
  const request = { hash: version.hash, slot }

  const existing = await time('lookup', () => findRun(db, request))
  if (existing !== undefined) return fromRow(existing, bundle)

  const computed = await time('kernel', () => compute(version.body, bundle))
  const [inserted] = await time('insert', () =>
    db
      .insert(runs)
      .values({ policyHash: version.hash, slot, ...computed.row })
      .onConflictDoNothing()
      .returning(),
  )
  if (inserted !== undefined) {
    return { row: inserted, bundle, ordering: computed.ordering, outcomes: computed.outcomes }
  }

  const winner = await findRun(db, request)
  if (winner === undefined) throw new Error(`run (${version.hash}, ${slot}) vanished`)

  return fromRow(winner, bundle)
}

/** The kernel values of a stored run, signatures put back from its slot. */
function fromRow(row: RunRow, bundle: SlotBundle): SlotRun {
  return {
    row,
    bundle,
    ordering: hydrateOrdering(row.result.ordering, bundle),
    outcomes: row.result.outcomes,
  }
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
): {
  row: Pick<RunRow, 'baseline' | 'result' | 'metrics'>
  ordering: Ordering
  outcomes: TripleOutcome[]
} {
  const sandwiches = findSandwiches(bundle)
  const ordering = apply(policy, bundle)
  const outcomes = sandwiches.map((sandwich) => tripleOutcome(sandwich, ordering))

  return {
    row: {
      baseline: {
        attacks: sandwiches.map((sandwich) => ({
          ...sandwich,
          extracted: serializeExtractedValue(extractedValue(bundle, sandwich)),
        })),
      },
      result: { ordering: serializeOrdering(ordering), outcomes },
      metrics: runMetrics(bundle, ordering),
    },
    ordering,
    outcomes,
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
