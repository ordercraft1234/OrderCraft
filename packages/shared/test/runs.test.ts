import { apply, policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import {
  createRunRequestSchema,
  hydrateOrdering,
  orderingSchema,
  runSchema,
  serializeOrdering,
  serializeRun,
} from '../src/runs.ts'
import { POLICY, SLOT, bundleOf, runOver } from './helpers.ts'

describe('ordering on the wire', () => {
  it('round-trips through JSON and comes back with its signatures', () => {
    const bundle = bundleOf(8)
    const ordering = apply(POLICY, bundle)

    const wire = orderingSchema.parse(JSON.parse(JSON.stringify(serializeOrdering(ordering))))
    expect(hydrateOrdering(wire, bundle)).toEqual(ordering)
  })

  it('carries no signature', () => {
    const wire = serializeOrdering(apply(POLICY, bundleOf(3)))

    for (const placement of [...wire.included, ...wire.excluded]) {
      expect(placement).not.toHaveProperty('signature')
    }
  })

  it('refuses to hydrate against another slot', () => {
    const wire = serializeOrdering(apply(POLICY, bundleOf(3)))
    const other = { ...bundleOf(3), slot: SLOT + 1 }

    expect(() => hydrateOrdering(wire, other)).toThrow(/slot/)
  })

  it('refuses a placement the slot does not have', () => {
    const wire = serializeOrdering(apply(POLICY, bundleOf(6)))

    expect(() => hydrateOrdering(wire, bundleOf(3))).toThrow(/no transaction/)
  })

  it('rejects a primitive the kernel does not have', () => {
    const wire = serializeOrdering(apply(POLICY, bundleOf(2)))
    const first = wire.included[0]
    if (first === undefined) throw new Error('expected a placement')

    const result = orderingSchema.safeParse({
      ...wire,
      included: [{ ...first, changedBy: 'randomShuffle' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('run on the wire', () => {
  it('survives JSON with every bigint intact', () => {
    const run = runOver(bundleOf(8))

    const text = JSON.stringify(serializeRun(run))
    expect(text).not.toContain('e+')
    expect(runSchema.parse(JSON.parse(text))).toEqual(run)
  })

  it('writes bigints as decimal strings', () => {
    const serialized = serializeRun(runOver(bundleOf(4)))
    const attack = serialized.baseline.attacks[0]
    if (attack === undefined) throw new Error('expected an attack')

    expect(attack.extracted.lamports).toBe('-10000')
    expect(attack.extracted.tokens[1]?.amount).toBe('12345678901234567890')
  })

  it('rejects a run with an outcome missing', () => {
    const run = serializeRun(runOver(bundleOf(4)))

    const result = runSchema.safeParse({ ...run, result: { ...run.result, outcomes: [] } })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['result', 'outcomes'])
  })

  it('rejects an ordering made on another slot', () => {
    const run = serializeRun(runOver(bundleOf(4)))

    const result = runSchema.safeParse({ ...run, slot: SLOT + 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['result', 'ordering', 'slot'])
  })

  it('rejects an ordering made by another policy', () => {
    const run = serializeRun(runOver(bundleOf(4)))
    const otherHash = policyHash({ ...POLICY, name: 'something else' })

    const result = runSchema.safeParse({ ...run, policyHash: otherHash })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['result', 'ordering', 'policyHash'])
  })

  it('rejects a fractional metric', () => {
    const run = serializeRun(runOver(bundleOf(4)))

    const result = runSchema.safeParse({
      ...run,
      metrics: { ...run.metrics, reorderedPerMille: 12.5 },
    })
    expect(result.success).toBe(false)
  })
})

describe('POST /runs', () => {
  it('takes a hash and a slot', () => {
    const request = createRunRequestSchema.parse({ hash: policyHash(POLICY), slot: SLOT })
    expect(request).toEqual({ hash: policyHash(POLICY), slot: SLOT })
  })

  it('rejects an upper-case or short hash', () => {
    expect(createRunRequestSchema.safeParse({ hash: 'ABCD', slot: SLOT }).success).toBe(false)
    expect(
      createRunRequestSchema.safeParse({ hash: policyHash(POLICY).toUpperCase(), slot: SLOT })
        .success,
    ).toBe(false)
  })

  it('rejects a slot that is not a whole number in range', () => {
    const hash = policyHash(POLICY)

    expect(createRunRequestSchema.safeParse({ hash, slot: -1 }).success).toBe(false)
    expect(createRunRequestSchema.safeParse({ hash, slot: 1.5 }).success).toBe(false)
    expect(createRunRequestSchema.safeParse({ hash, slot: 1e300 }).success).toBe(false)
    expect(createRunRequestSchema.safeParse({ hash, slot: '445553238' }).success).toBe(false)
  })
})
