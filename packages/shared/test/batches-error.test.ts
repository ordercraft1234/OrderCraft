import { policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_SLOTS,
  batchEventSchema,
  batchViewSchema,
  createBatchRequestSchema,
} from '../src/batches.ts'
import { ERROR_STATUS, apiError, apiErrorSchema, errorCode } from '../src/error.ts'
import { CREATED_AT, POLICY, RUN_ID, SLOT } from './helpers.ts'

const hash = policyHash(POLICY)

describe('POST /batches', () => {
  it('takes a hash and a set of slots', () => {
    const request = createBatchRequestSchema.parse({ hash, slots: [SLOT, SLOT + 1] })
    expect(request.slots).toEqual([SLOT, SLOT + 1])
  })

  it('refuses an empty list, a repeated slot and one past the ceiling', () => {
    expect(createBatchRequestSchema.safeParse({ hash, slots: [] }).success).toBe(false)

    const repeated = createBatchRequestSchema.safeParse({ hash, slots: [SLOT, SLOT] })
    expect(repeated.success).toBe(false)
    expect(repeated.error?.issues[0]?.message).toMatch(/twice/)

    const tooMany = Array.from({ length: MAX_BATCH_SLOTS + 1 }, (_, offset) => SLOT + offset)
    expect(createBatchRequestSchema.safeParse({ hash, slots: tooMany }).success).toBe(false)
    expect(
      createBatchRequestSchema.safeParse({ hash, slots: tooMany.slice(0, MAX_BATCH_SLOTS) })
        .success,
    ).toBe(true)
  })
})

describe('GET /batches/:id', () => {
  const view = {
    id: RUN_ID,
    policyHash: hash,
    slots: [SLOT, SLOT + 1, SLOT + 2],
    status: 'running',
    doneCount: 2,
    createdAt: CREATED_AT,
  }

  it('reports progress against the slots asked for', () => {
    expect(batchViewSchema.parse(view).doneCount).toBe(2)
  })

  it('cannot have finished more than it was given', () => {
    const result = batchViewSchema.safeParse({ ...view, doneCount: 4 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['doneCount'])
  })

  it('knows four states and no other', () => {
    for (const status of ['running', 'done', 'cancelled', 'failed']) {
      expect(batchViewSchema.safeParse({ ...view, status }).success).toBe(true)
    }
    expect(batchViewSchema.safeParse({ ...view, status: 'paused' }).success).toBe(false)
  })
})

describe('batch events', () => {
  it('progress carries the counts, failed carries a message', () => {
    expect(batchEventSchema.parse({ event: 'progress', doneCount: 1, total: 3 })).toEqual({
      event: 'progress',
      doneCount: 1,
      total: 3,
    })
    expect(batchEventSchema.parse({ event: 'done' })).toEqual({ event: 'done' })
    expect(batchEventSchema.safeParse({ event: 'failed' }).success).toBe(false)
    expect(batchEventSchema.safeParse({ event: 'progress', doneCount: 1 }).success).toBe(false)
  })
})

describe('error envelope', () => {
  it('every code has a status and the schema knows the same codes', () => {
    expect(errorCode.options.sort()).toEqual(Object.keys(ERROR_STATUS).sort())
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })

  it('builds what it parses', () => {
    const envelope = apiError('NOT_FOUND', 'no run 42', { id: '42' })
    expect(apiErrorSchema.parse(envelope)).toEqual(envelope)
    expect(apiError('INTERNAL', 'x').error.details).toEqual({})
  })

  it('refuses an unknown code, an empty message and a missing details', () => {
    expect(
      apiErrorSchema.safeParse({ error: { code: 'OOPS', message: 'x', details: {} } }).success,
    ).toBe(false)
    expect(
      apiErrorSchema.safeParse({ error: { code: 'INTERNAL', message: '', details: {} } }).success,
    ).toBe(false)
    expect(apiErrorSchema.safeParse({ error: { code: 'INTERNAL', message: 'x' } }).success).toBe(
      false,
    )
  })
})
