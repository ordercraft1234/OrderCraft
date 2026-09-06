import { describe, expect, it } from 'vitest'
import { runMetrics } from '../src/metrics/run.ts'
import { apply } from '../src/order/apply.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import { ATTACKER, VICTIM, bundleOf, tx } from './helpers/build.ts'

const policyOf = (...steps: Policy['steps']): Policy => ({
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'test policy',
  steps,
})

// Eight transactions, so arrivals fall every 50 ms: 0, 50, 100 … 350.
const bundle = bundleOf(
  [...Array(8).keys()].map((index) =>
    tx(index, { signers: [index % 2 === 0 ? ATTACKER : VICTIM] }),
  ),
)

const measure = (policy: Policy, slot = bundle) => runMetrics(slot, apply(policy, slot))

describe('runMetrics', () => {
  it('reports nothing moved when no step moves anything', () => {
    const metrics = measure(
      policyOf({ kind: 'speedBump', delayMs: 0, appliesTo: { match: 'all' } }),
    )

    expect(metrics).toMatchObject({
      recorded: 8,
      included: 8,
      deferred: 0,
      dropped: 0,
      moved: 0,
      delayed: 0,
      reorderedPerMille: 0,
    })
    expect(metrics.addedDelayMs).toEqual({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })
  })

  it('counts the delayed class and reports the delay distribution', () => {
    const metrics = measure(
      policyOf({
        kind: 'speedBump',
        delayMs: 60,
        appliesTo: { match: 'signer', signers: [ATTACKER] },
      }),
    )

    // Delays over the eight included transactions: four zeros and four 60s.
    expect(metrics.delayed).toBe(4)
    expect(metrics.addedDelayMs).toEqual({ p10: 0, p50: 0, p90: 60, p95: 60, max: 60 })
  })

  it('counts every transaction whose place changed', () => {
    // A 60 ms bump on the even indices swaps each of them with the odd one behind it,
    // so nothing keeps its place.
    const metrics = measure(
      policyOf({
        kind: 'speedBump',
        delayMs: 60,
        appliesTo: { match: 'signer', signers: [ATTACKER] },
      }),
    )

    expect(metrics.moved).toBe(8)
    expect(metrics.reorderedPerMille).toBe(1000)
  })

  it('does not call a transaction moved just because something ahead of it was dropped', () => {
    const metrics = measure(
      policyOf({
        kind: 'allowDeny',
        rules: [{ effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } }],
      }),
    )

    // The four survivors are still in the order the block recorded them. Measuring
    // against the recorded positions instead would report all four as moved.
    expect(metrics).toMatchObject({
      recorded: 8,
      included: 4,
      dropped: 4,
      deferred: 0,
      moved: 0,
      reorderedPerMille: 0,
    })
  })

  it('keeps deferred out of the delay distribution and says how many there were', () => {
    const metrics = measure(
      policyOf({ kind: 'speedBump', delayMs: 100, appliesTo: { match: 'all' } }),
    )

    // Two transactions were pushed out of the block; the six that remain were each
    // delayed by exactly 100 ms. The percentiles describe the six, and `deferred` is
    // what stops that from reading as the whole story.
    expect(metrics).toMatchObject({ included: 6, deferred: 2, dropped: 0, delayed: 6 })
    expect(metrics.addedDelayMs).toEqual({ p10: 100, p50: 100, p90: 100, p95: 100, max: 100 })
  })

  it('counts a batch auction as delay, because that is what it costs', () => {
    const metrics = measure(
      policyOf({ kind: 'batchAuction', windowMs: 100, appliesTo: { match: 'all' } }),
    )

    // Arrivals 0, 50, 100 … settle at 100, 100, 200 …: delays 100, 50, 100, 50 …
    expect(metrics.delayed).toBe(6)
    expect(metrics.addedDelayMs.max).toBe(100)
  })

  it('reports whole numbers only', () => {
    const metrics = measure(
      policyOf({
        kind: 'speedBump',
        delayMs: 33,
        appliesTo: { match: 'signer', signers: [VICTIM] },
      }),
    )
    const numbers = [
      metrics.recorded,
      metrics.included,
      metrics.deferred,
      metrics.dropped,
      metrics.moved,
      metrics.delayed,
      metrics.reorderedPerMille,
      ...Object.values(metrics.addedDelayMs),
    ]

    expect(numbers.every((value) => Number.isInteger(value))).toBe(true)
  })

  it('handles a slot with no transactions', () => {
    const metrics = measure(
      policyOf({ kind: 'speedBump', delayMs: 50, appliesTo: { match: 'all' } }),
      bundleOf([]),
    )

    expect(metrics).toMatchObject({ recorded: 0, included: 0, moved: 0, reorderedPerMille: 0 })
    expect(metrics.addedDelayMs).toEqual({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })
  })

  describe('percentiles', () => {
    // Ten transactions, so arrivals fall every 40 ms and a percentile lands on a
    // countable rank.
    const ten = bundleOf([...Array(10).keys()].map((index) => tx(index, { signers: [ATTACKER] })))

    it('takes the nearest rank rather than interpolating', () => {
      const metrics = measure(
        policyOf({ kind: 'speedBump', delayMs: 30, appliesTo: { match: 'all' } }),
        ten,
      )

      // Every included transaction was delayed by the same 30 ms, so every percentile
      // is 30 — an interpolating implementation would agree here.
      expect(metrics.addedDelayMs).toEqual({ p10: 30, p50: 30, p90: 30, p95: 30, max: 30 })
    })

    it('puts p50 on the fifth of ten values, not between the fifth and sixth', () => {
      const half = bundleOf(
        [...Array(10).keys()].map((index) =>
          tx(index, { signers: [index < 5 ? ATTACKER : VICTIM] }),
        ),
      )
      const metrics = measure(
        policyOf({
          kind: 'speedBump',
          delayMs: 30,
          appliesTo: { match: 'signer', signers: [VICTIM] },
        }),
        half,
      )

      // Delays sorted: 0 0 0 0 0 30 30 30 30 30. Nearest rank puts p50 on the fifth
      // value, which is 0; an interpolating percentile would answer 15 — a number no
      // transaction in this run experienced.
      expect(metrics.addedDelayMs.p50).toBe(0)
      expect(metrics.addedDelayMs.p90).toBe(30)
      expect(metrics.addedDelayMs.p95).toBe(30)
    })
  })
})
