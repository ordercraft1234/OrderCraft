import { zValidator } from '@hono/zod-validator'
import type { Db } from '@ordercraft/db'
import { listSlotsQuerySchema, slotParamSchema } from '@ordercraft/shared'
import { Hono } from 'hono'
import type { SlotStore } from '../services/slots.ts'
import { rejectInvalid } from '../validate.ts'

export function slotRoutes(db: Db, store: SlotStore) {
  return new Hono()
    .get('/', zValidator('query', listSlotsQuerySchema, rejectInvalid), async (c) => {
      return c.json(await store.list(db, c.req.valid('query').source))
    })
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
