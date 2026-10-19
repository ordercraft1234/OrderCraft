import { type BrokenReason, PRIMITIVES, type PrimitiveKind } from '@ordercraft/core'
import { z } from 'zod'
import { brokenReason, percentilesSchema } from './runs.ts'
import { policyHashHex, slotNumber, timestamp, uuid } from './scalars.ts'

/**
 * How many slots one batch may name (FR-016). Two hundred is the ceiling from the
 * plan's size limits; SC-005 is measured on a hundred.
 */
export const MAX_BATCH_SLOTS = 200

const count = z.number().int().nonnegative()

/** Every primitive a broken triple can be credited to, plus `unattributed`, each a count. */
const byPrimitiveSchema = z.object(
  Object.fromEntries(
    [...PRIMITIVES.map((primitive) => primitive.kind), 'unattributed'].map((key) => [key, count]),
  ) as Record<PrimitiveKind | 'unattributed', typeof count>,
)

const byReasonSchema = z.object(
  Object.fromEntries(brokenReason.options.map((key) => [key, count])) as Record<
    BrokenReason,
    typeof count
  >,
)

/**
 * `BatchReport` as the kernel builds it (FR-016): whole numbers throughout, so the JSON
 * is the report and nothing is converted on the way. Checked against the kernel's type
 * in `test/types.test.ts`.
 *
 * The internal sums are checked here too — a report whose parts do not add up to its
 * totals would draw a chart that contradicts its own caption.
 */
export const batchReportSchema = z
  .object({
    policyHash: policyHashHex,
    blocks: count,
    slots: z.array(slotNumber),
    transactions: z.object({
      recorded: count,
      included: count,
      deferred: count,
      dropped: count,
      moved: count,
      delayed: count,
    }),
    addedDelayMs: percentilesSchema.nullable(),
    heldDelayMs: percentilesSchema.nullable(),
    perBlock: z.object({
      reorderedPerMille: percentilesSchema.nullable(),
      deferredPerMille: percentilesSchema.nullable(),
      droppedPerMille: percentilesSchema.nullable(),
      triples: percentilesSchema.nullable(),
    }),
    triples: z.object({
      found: count,
      broken: count,
      possible: count,
      byPrimitive: byPrimitiveSchema,
      byReason: byReasonSchema,
    }),
    unchangedBlocks: count,
  })
  .superRefine((report, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

    if (report.slots.length !== report.blocks) {
      issue(['slots'], `${report.slots.length} slots listed for ${report.blocks} blocks`)
    }
    if (
      report.slots.some(
        (slot, position) => position > 0 && slot <= (report.slots[position - 1] ?? 0),
      )
    ) {
      issue(['slots'], 'slots are not strictly ascending')
    }

    const { recorded, included, deferred, dropped } = report.transactions
    if (included + deferred + dropped !== recorded) {
      issue(['transactions'], 'included, deferred and dropped do not add up to recorded')
    }

    const { found, broken, possible, byPrimitive, byReason } = report.triples
    if (broken + possible !== found)
      issue(['triples'], 'broken and possible do not add up to found')
    const sum = (record: Record<string, number>) =>
      Object.values(record).reduce((total, value) => total + value, 0)
    if (sum(byPrimitive) !== broken) {
      issue(['triples', 'byPrimitive'], 'broken triples by primitive do not add up to broken')
    }
    if (sum(byReason) !== broken) {
      issue(['triples', 'byReason'], 'broken triples by reason do not add up to broken')
    }

    if (report.unchangedBlocks > report.blocks) {
      issue(['unchangedBlocks'], 'more unchanged blocks than blocks')
    }
  })

export type SerializedBatchReport = z.input<typeof batchReportSchema>

/**
 * `POST /batches`. The list is a set: a slot named twice would be run once and counted
 * twice, and the progress bar would never reach its own total.
 */
export const createBatchRequestSchema = z.object({
  hash: policyHashHex,
  slots: z
    .array(slotNumber)
    .min(1, 'a batch needs at least one slot')
    .max(MAX_BATCH_SLOTS, `at most ${MAX_BATCH_SLOTS} slots in one batch`)
    .refine((slots) => new Set(slots).size === slots.length, 'a slot is listed twice'),
})

export type CreateBatchRequest = z.infer<typeof createBatchRequestSchema>

export const createBatchResponseSchema = z.object({ batchId: uuid })

/**
 * `cancelled` keeps every run finished so far (FR-017). `failed` is the server stopping
 * before the end — a restart, or a slot that could not be read although its file was on
 * disk when the batch was accepted — and keeps the finished runs just the same. Every
 * slot's file is checked before a batch starts, so the sample a report describes is the
 * one asked for, or a prefix of it, never the set with holes cut in it.
 */
export const batchStatus = z.enum(['running', 'done', 'cancelled', 'failed'])

export type BatchStatus = z.infer<typeof batchStatus>

/**
 * `GET /batches/:id`. While the batch runs, the view says how far it got; once it has
 * stopped, for whatever reason, `report` is the aggregate over the runs it finished
 * (FR-016) — the runs themselves stay reachable by `(hash, slot)`.
 */
export const batchViewSchema = z
  .object({
    id: uuid,
    policyHash: policyHashHex,
    slots: z.array(slotNumber).min(1).max(MAX_BATCH_SLOTS),
    status: batchStatus,
    doneCount: z.number().int().nonnegative(),
    report: batchReportSchema.nullable(),
    createdAt: timestamp,
  })
  .superRefine((batch, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

    if (batch.doneCount > batch.slots.length) {
      issue(['doneCount'], 'more runs finished than slots were asked for')
    }
    if ((batch.status === 'running') !== (batch.report === null)) {
      issue(['report'], 'a report exists exactly when the batch has stopped')
    }
    if (batch.report === null) return

    if (batch.report.policyHash !== batch.policyHash) {
      issue(['report', 'policyHash'], 'the report is about a different policy')
    }
    if (batch.report.blocks !== batch.doneCount) {
      issue(['report', 'blocks'], 'the report counts a different number of runs than finished')
    }
    const asked = new Set(batch.slots)
    if (batch.report.slots.some((slot) => !asked.has(slot))) {
      issue(['report', 'slots'], 'the report counts a slot the batch did not ask for')
    }
  })

export type BatchView = z.infer<typeof batchViewSchema>

/** `GET /batches/:id/events` — one SSE message per event, `event:` set to the tag. */
export const batchEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('progress'),
    doneCount: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  z.object({ event: z.literal('done') }),
  z.object({ event: z.literal('cancelled') }),
  z.object({ event: z.literal('failed'), message: z.string().min(1) }),
])

export type BatchEvent = z.infer<typeof batchEventSchema>

/** `POST /batches/:id/cancel`. */
export const cancelBatchResponseSchema = z.object({ status: z.literal('cancelled') })

export const batchIdParamSchema = z.object({ id: uuid })
