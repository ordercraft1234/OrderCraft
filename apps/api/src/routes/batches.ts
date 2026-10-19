import { zValidator } from '@hono/zod-validator'
import { batchIdParamSchema, createBatchRequestSchema } from '@ordercraft/shared'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BatchRunner } from '../services/batches.ts'
import { rejectInvalid } from '../validate.ts'

export function batchRoutes(runner: BatchRunner) {
  return new Hono()
    .post('/', zValidator('json', createBatchRequestSchema, rejectInvalid), async (c) => {
      return c.json(await runner.create(c.req.valid('json')), 201)
    })
    .get('/:id', zValidator('param', batchIdParamSchema, rejectInvalid), async (c) => {
      return c.json(await runner.get(c.req.valid('param').id))
    })
    .get('/:id/events', zValidator('param', batchIdParamSchema, rejectInvalid), async (c) => {
      const { id } = c.req.valid('param')
      // Asked before the stream opens, so an unknown id is a 404 in the error envelope
      // rather than a stream that ends with nothing in it.
      await runner.get(id)

      return streamSSE(c, async (stream) => {
        const gone = new AbortController()
        stream.onAbort(() => gone.abort())

        for await (const event of runner.events(id, gone.signal)) {
          await stream.writeSSE({ event: event.event, data: JSON.stringify(event) })
        }
      })
    })
    .post('/:id/cancel', zValidator('param', batchIdParamSchema, rejectInvalid), async (c) => {
      return c.json(await runner.cancel(c.req.valid('param').id))
    })
}
