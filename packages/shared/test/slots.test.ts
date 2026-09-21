import { serializeSlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { MAX_SLOT } from '../src/scalars.ts'
import {
  fetchSlotRequestSchema,
  fetchSlotResponseSchema,
  listSlotsQuerySchema,
  listSlotsResponseSchema,
  slotBundleResponseSchema,
  slotParamSchema,
} from '../src/slots.ts'
import { SLOT, bundleOf } from './helpers.ts'

describe('GET /slots', () => {
  it('lists every source when none is asked for', () => {
    expect(listSlotsQuerySchema.parse({})).toEqual({ source: 'all' })
    expect(listSlotsQuerySchema.parse({ source: 'rpc' })).toEqual({ source: 'rpc' })
    expect(listSlotsQuerySchema.safeParse({ source: 'cache' }).success).toBe(false)
  })

  it('answers with summaries, never with blocks', () => {
    const list = listSlotsResponseSchema.parse([
      { slot: SLOT, source: 'fixture', txCount: 3, hasLabels: true },
      { slot: SLOT + 1, source: 'rpc', txCount: 1500, hasLabels: false },
    ])
    expect(list).toHaveLength(2)

    const result = listSlotsResponseSchema.safeParse([
      { slot: SLOT, source: 'fixture', txCount: 3, hasLabels: true, transactions: [] },
    ])
    expect(result.success).toBe(true)
    expect(result.data?.[0]).not.toHaveProperty('transactions')
  })
})

describe('GET /slots/:slot', () => {
  it('reads the slot off the path as digits', () => {
    expect(slotParamSchema.parse({ slot: '445553238' })).toEqual({ slot: 445553238 })
    expect(slotParamSchema.parse({ slot: '0' })).toEqual({ slot: 0 })
  })

  it('refuses anything that is not plain digits', () => {
    for (const bad of ['1e9', ' 7', '07', '-1', 'latest', '', '4.5']) {
      expect(slotParamSchema.safeParse({ slot: bad }).success).toBe(false)
    }
  })

  it('refuses a slot past the range', () => {
    expect(slotParamSchema.safeParse({ slot: String(MAX_SLOT) }).success).toBe(true)
    expect(slotParamSchema.safeParse({ slot: String(MAX_SLOT + 1) }).success).toBe(false)
  })

  it('answers in the fixture format, bigints and all', () => {
    const bundle = bundleOf(3)
    const parsed = slotBundleResponseSchema.parse(
      JSON.parse(JSON.stringify(serializeSlotBundle(bundle))),
    )
    expect(parsed).toEqual(bundle)
  })
})

describe('POST /slots/fetch', () => {
  it('takes one slot', () => {
    expect(fetchSlotRequestSchema.parse({ slot: SLOT })).toEqual({ slot: SLOT })
    expect(fetchSlotRequestSchema.safeParse({ slot: String(SLOT) }).success).toBe(false)
    expect(fetchSlotRequestSchema.safeParse({ slots: [SLOT] }).success).toBe(false)
  })

  it('says whether the network was touched', () => {
    const response = fetchSlotResponseSchema.parse({ slot: SLOT, txCount: 1500, cached: true })
    expect(response.cached).toBe(true)
    expect(fetchSlotResponseSchema.safeParse({ slot: SLOT, txCount: 1500 }).success).toBe(false)
  })
})
