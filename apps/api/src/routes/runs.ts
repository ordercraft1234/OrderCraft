import { zValidator } from '@hono/zod-validator'
import type { Db } from '@ordercraft/db'
import { createRunRequestSchema, runIdParamSchema } from '@ordercraft/shared'
import { Hono } from 'hono'
import { createRun, getRun } from '../services/runs.ts'
import type { SlotStore } from '../services/slots.ts'
import { rejectInvalid } from '../validate.ts'

export function runRoutes(db: Db, store: SlotStore) {
  return new Hono()
    .post('/', zValidator('json', createRunRequestSchema, rejectInvalid), async (c) => {
      return c.json(await createRun(db, store, c.req.valid('json')))
    })
    .get('/:id', zValidator('param', runIdParamSchema, rejectInvalid), async (c) => {
      return c.json(await getRun(db, c.req.valid('param').id))
    })
}
