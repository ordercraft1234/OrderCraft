import { zValidator } from '@hono/zod-validator'
import type { Db } from '@ordercraft/db'
import {
  ERROR_STATUS,
  apiError,
  fetchSlotRequestSchema,
  listSlotsQuerySchema,
  slotParamSchema,
} from '@ordercraft/shared'
import { Hono } from 'hono'
import { rateLimit } from '../rateLimit.ts'
import type { SlotFetcher } from '../services/fetch.ts'
import type { SlotStore } from '../services/slots.ts'
import { rejectInvalid } from '../validate.ts'

/** The plan's ceiling on live fetches: ten a minute from one address. */
export const FETCH_LIMIT = { limit: 10, windowMs: 60_000 }

export interface SlotRouteOptions {
  /** Absent while `SOLANA_RPC_URL` is unset: `/slots/fetch` then answers 403. */
  fetcher?: SlotFetcher | undefined
  now?: (() => number) | undefined
}

export function slotRoutes(db: Db, store: SlotStore, options: SlotRouteOptions = {}) {
  const { fetcher } = options

  return new Hono()
    .get('/', zValidator('query', listSlotsQuerySchema, rejectInvalid), async (c) => {
      return c.json(await store.list(db, c.req.valid('query').source))
    })
    .post(
      '/fetch',
      rateLimit({ ...FETCH_LIMIT, ...(options.now === undefined ? {} : { now: options.now }) }),
      zValidator('json', fetchSlotRequestSchema, rejectInvalid),
      async (c) => {
        // Checked after the limit, not before: a client hammering a disabled door is
        // still hammering, and the answer costs the same either way.
        if (fetcher === undefined) {
          return c.json(
            apiError('RPC_DISABLED', 'live fetching is off: this server has no RPC address'),
            ERROR_STATUS.RPC_DISABLED,
          )
        }

        return c.json(await fetcher.fetch(db, store, c.req.valid('json').slot))
      },
    )
    .get('/:slot', zValidator('param', slotParamSchema, rejectInvalid), async (c) => {
      const bytes = await store.bytes(db, c.req.valid('param').slot)

      // The file is gzip already; it is sent as it is and declared as such, so the
      // browser unpacks it and the fixture loader sees plain JSON — the same path the
      // shipped demo slot takes from a static host.
      return c.body(new Uint8Array(bytes), 200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'cache-control': 'public, max-age=31536000, immutable',
      })
    })
}
