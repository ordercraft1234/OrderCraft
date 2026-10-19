import { apply, batchEntry, batchReport, policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_SLOTS,
  batchEventSchema,
  batchReportSchema,
  batchViewSchema,
  createBatchRequestSchema,
} from '../src/batches.ts'
import { ERROR_STATUS, apiError, apiErrorSchema, errorCode } from '../src/error.ts'
import { CREATED_AT, POLICY, RUN_ID, SLOT, bundleOf } from './helpers.ts'

const hash = policyHash(POLICY)

/** The kernel's report over two quiet blocks — the shape the server stores and sends. */
function reportOver(slots: number[]) {
  const entries = slots.map((slot) => {
    const bundle = { ...bundleOf(5), slot }
    return batchEntry(bundle, apply(POLICY, bundle), [])
  })

  return batchReport(hash, entries)
}

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
    report: null,
    createdAt: CREATED_AT,
  }

  it('reports progress against the slots asked for', () => {
    expect(batchViewSchema.parse(view).doneCount).toBe(2)
  })

  it('carries the report once the batch has stopped, and only then', () => {
    const report = reportOver([SLOT, SLOT + 1])
    for (const status of ['done', 'cancelled', 'failed']) {
      expect(batchViewSchema.safeParse({ ...view, status, report }).success).toBe(true)
      expect(batchViewSchema.safeParse({ ...view, status }).success).toBe(false)
    }
    const running = batchViewSchema.safeParse({ ...view, report })
    expect(running.success).toBe(false)
    expect(running.error?.issues[0]?.path).toEqual(['report'])
  })

  it('a cancelled batch with nothing finished reports an empty sample', () => {
    const report = reportOver([])
    expect(report.addedDelayMs).toBeNull()
    expect(
      batchViewSchema.safeParse({ ...view, status: 'cancelled', doneCount: 0, report }).success,
    ).toBe(true)
  })

  it('refuses a report about other runs than the ones the view counts', () => {
    const stopped = { ...view, status: 'cancelled' }
    const paths = (candidate: unknown) =>
      batchViewSchema.safeParse(candidate).error?.issues.map((issue) => issue.path.join('.'))

    expect(paths({ ...stopped, report: reportOver([SLOT]) })).toEqual(['report.blocks'])
    expect(paths({ ...stopped, report: reportOver([SLOT, SLOT + 7]) })).toEqual(['report.slots'])
    expect(
      paths({
        ...stopped,
        report: { ...reportOver([SLOT, SLOT + 1]), policyHash: 'a'.repeat(64) },
      }),
    ).toEqual(['report.policyHash'])
  })

  it('cannot have finished more than it was given', () => {
    const result = batchViewSchema.safeParse({ ...view, doneCount: 4 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['doneCount'])
  })

  it('knows four states and no other', () => {
    const report = reportOver([SLOT, SLOT + 1])
    expect(batchViewSchema.safeParse(view).success).toBe(true)
    for (const status of ['done', 'cancelled', 'failed']) {
      expect(batchViewSchema.safeParse({ ...view, status, report }).success).toBe(true)
    }
    expect(batchViewSchema.safeParse({ ...view, status: 'paused' }).success).toBe(false)
  })
})

describe('batch report', () => {
  it('parses what the kernel builds, unchanged', () => {
    const report = reportOver([SLOT, SLOT + 1])
    expect(batchReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report)
  })

  it('refuses parts that do not add up to their totals', () => {
    const report = reportOver([SLOT, SLOT + 1])
    const paths = (candidate: unknown) =>
      batchReportSchema.safeParse(candidate).error?.issues.map((issue) => issue.path.join('.'))

    expect(paths({ ...report, blocks: 3 })).toEqual(['slots'])
    expect(paths({ ...report, slots: [SLOT + 1, SLOT] })).toEqual(['slots'])
    expect(
      paths({
        ...report,
        transactions: { ...report.transactions, dropped: report.transactions.dropped + 1 },
      }),
    ).toEqual(['transactions'])
    expect(paths({ ...report, triples: { ...report.triples, found: 1 } })).toEqual(['triples'])
    expect(
      paths({
        ...report,
        triples: {
          ...report.triples,
          byPrimitive: { ...report.triples.byPrimitive, speedBump: 1 },
        },
      }),
    ).toEqual(['triples.byPrimitive'])
    expect(paths({ ...report, unchangedBlocks: 3 })).toEqual(['unchangedBlocks'])
  })

  it('counts broken triples under every primitive the kernel knows and no other', () => {
    const { byPrimitive, byReason } = batchReportSchema.parse(reportOver([SLOT])).triples
    expect(Object.keys(byPrimitive).sort()).toEqual(
      ['allowDeny', 'batchAuction', 'speedBump', 'unattributed'].sort(),
    )
    expect(Object.keys(byReason).sort()).toEqual(
      ['legLeftBlock', 'orderChanged', 'sameBatch', 'victimsLeftBlock'].sort(),
    )
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
