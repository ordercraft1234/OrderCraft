import { slotBundleSchema } from '@ordercraft/core'
import { z } from 'zod'
import { slotNumber, slotSegment } from './scalars.ts'

/**
 * Where a slot came from. `fixture` is the curated set in `packages/fixtures`, checked
 * into the repository; `rpc` is a block fetched live and cached outside it (FR-024).
 * Both are stored in the same format — the source says who vouches for the file, not
 * how to read it.
 */
export const slotSource = z.enum(['fixture', 'rpc'])

export type SlotSource = z.infer<typeof slotSource>

/** `GET /slots?source=` — `all` when omitted. */
export const listSlotsQuerySchema = z.object({
  source: z.enum(['fixture', 'rpc', 'all']).default('all'),
})

export const slotSummarySchema = z.object({
  slot: slotNumber,
  source: slotSource,
  txCount: z.number().int().nonnegative(),
  /** Whether hand-checked labels exist for it (FR-028) — only ever true for a fixture. */
  hasLabels: z.boolean(),
})

export type SlotSummary = z.infer<typeof slotSummarySchema>

export const listSlotsResponseSchema = z.array(slotSummarySchema)

/** `GET /slots/:slot` — the bundle itself, exactly as a fixture file is written. */
export const slotParamSchema = z.object({ slot: slotSegment })

export const slotBundleResponseSchema = slotBundleSchema

/**
 * `POST /slots/fetch` (FR-023). Answers `403 RPC_DISABLED` until the server has an RPC
 * address, `429 RATE_LIMITED` past ten calls a minute from one address, and otherwise
 * returns the slot from the cache or, on a miss, fetches it into the cache first.
 */
export const fetchSlotRequestSchema = z.object({ slot: slotNumber })

export type FetchSlotRequest = z.infer<typeof fetchSlotRequestSchema>

export const fetchSlotResponseSchema = z.object({
  slot: slotNumber,
  txCount: z.number().int().nonnegative(),
  /** `true` when the block was already on disk and the network was not touched. */
  cached: z.boolean(),
})

export type FetchSlotResponse = z.infer<typeof fetchSlotResponseSchema>
