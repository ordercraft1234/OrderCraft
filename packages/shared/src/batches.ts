import { z } from 'zod'
import { policyHashHex, slotNumber, timestamp, uuid } from './scalars.ts'

/**
 * How many slots one batch may name (FR-016). Two hundred is the ceiling from the
 * plan's size limits; SC-005 is measured on a hundred.
 */
export const MAX_BATCH_SLOTS = 200

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
 * `cancelled` keeps every run finished so far (FR-017); `failed` is the server giving
 * up on the batch, not on any one slot — a slot that will not load fails its own run
 * and the batch goes on.
 */
export const batchStatus = z.enum(['running', 'done', 'cancelled', 'failed'])

export type BatchStatus = z.infer<typeof batchStatus>

/**
 * `GET /batches/:id`. The aggregated report (p50/p95 over the finished runs, FR-016)
 * is added here by the task that defines it in the kernel; until then the view says
 * how far the batch got, and the runs themselves are reachable by `(hash, slot)`.
 */
export const batchViewSchema = z
  .object({
    id: uuid,
    policyHash: policyHashHex,
    slots: z.array(slotNumber).min(1).max(MAX_BATCH_SLOTS),
    status: batchStatus,
    doneCount: z.number().int().nonnegative(),
    createdAt: timestamp,
  })
  .refine((batch) => batch.doneCount <= batch.slots.length, {
    path: ['doneCount'],
    message: 'more runs finished than slots were asked for',
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
