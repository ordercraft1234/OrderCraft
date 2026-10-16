import { describe, expect, it } from 'vitest'
import type { TripleOutcome } from '../src/detect/broken.ts'
import { batchEntry, batchReport } from '../src/metrics/batch.ts'
import { runMetrics } from '../src/metrics/run.ts'
import { apply } from '../src/order/apply.ts'
import { canonicalize, policyHash } from '../src/policy/compile.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import { arrivalMs } from '../src/primitives/placement.ts'
import type { SlotBundle } from '../src/slot/schema.ts'
import { ATTACKER, VICTIM, bundleOf, tx } from './helpers/build.ts'

const policyOf = (...steps: Policy['steps']): Policy => ({
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'batch test policy',
  steps,
})

const bump = (delayMs: number) =>
  policyOf({ kind: 'speedBump', delayMs, appliesTo: { match: 'signer', signers: [ATTACKER] } })

const deny = policyOf({
  kind: 'allowDeny',
  rules: [{ effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } }],
})

/** Blocks of different sizes, so arrivals and delays do not line up between them. */
function blockOf(slot: number, size: number, attackerEvery = 2): SlotBundle {
  return {
    ...bundleOf(
      [...Array(size).keys()].map((index) =>
        tx(index, { signers: [index % attackerEvery === 0 ? ATTACKER : VICTIM] }),
      ),
    ),
    slot,
  }
}

const BROKEN_BY_BUMP: TripleOutcome = { broken: true, reason: 'orderChanged', by: 'speedBump' }
const BROKEN_BY_DENY: TripleOutcome = { broken: true, reason: 'legLeftBlock', by: 'allowDeny' }
const STILL_POSSIBLE: TripleOutcome = { broken: false, reason: null, by: null }

function entryOf(policy: Policy, bundle: SlotBundle, outcomes: TripleOutcome[] = []) {
  return batchEntry(bundle, apply(policy, bundle), outcomes)
}

/** Every added delay over the included transactions, the long way round. */
function delaysOf(policy: Policy, bundle: SlotBundle): number[] {
  return apply(policy, bundle).included.map(
    (placement) => placement.timeMs - arrivalMs(placement.index, bundle.transactions.length),
  )
}

/** Nearest rank written independently of the kernel, with the `Math` the kernel may not use. */
function referencePercentile(values: number[], percent: number): number {
  const ascending = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil((percent * ascending.length) / 100))
  return ascending[Math.min(rank, ascending.length) - 1] ?? 0
}

describe('batchEntry', () => {
  it('carries the run metrics unchanged', () => {
    const bundle = blockOf(1, 8)
    const entry = entryOf(bump(60), bundle)

    expect(entry.slot).toBe(1)
    expect(entry.policyHash).toBe(policyHash(bump(60)))
    expect(entry.metrics).toEqual(runMetrics(bundle, apply(bump(60), bundle)))
  })

  it('counts every added delay exactly, ascending by milliseconds', () => {
    const bundle = blockOf(1, 13, 3)
    const entry = entryOf(bump(37), bundle)

    const expanded = entry.addedDelayCounts.flatMap(([ms, count]) =>
      Array.from({ length: count }, () => ms),
    )
    expect(expanded).toEqual(delaysOf(bump(37), bundle).sort((left, right) => left - right))

    const steps = entry.addedDelayCounts.map(([ms]) => ms)
    expect(steps).toEqual([...new Set(steps)].sort((left, right) => left - right))
    expect(entry.addedDelayCounts.every(([, count]) => count > 0)).toBe(true)
  })

  it('refuses an ordering that belongs to another slot', () => {
    const ordering = apply(bump(60), blockOf(2, 8))
    expect(() => batchEntry(blockOf(1, 8), ordering, [])).toThrow(/slot/)
  })
})

describe('batchReport', () => {
  it('gives a one-block batch exactly the delay percentiles of that run', () => {
    for (const policy of [bump(0), bump(60), bump(100), deny]) {
      const bundle = blockOf(5, 11, 3)
      const report = batchReport(policyHash(policy), [entryOf(policy, bundle)])

      expect(report.addedDelayMs).toEqual(runMetrics(bundle, apply(policy, bundle)).addedDelayMs)
    }
  })

  it('pools added delay over every included transaction of the batch, not over blocks', () => {
    // One large block where the bump holds almost everyone, three small ones where it
    // holds one transaction each: pooled, the median transaction waited; by block, the
    // median block's median transaction did not.
    const policy = bump(45)
    const bundles = [blockOf(10, 40, 1), blockOf(11, 5, 99), blockOf(12, 6, 99), blockOf(13, 7, 99)]
    const entries = bundles.map((bundle) => entryOf(policy, bundle))
    const report = batchReport(policyHash(policy), entries)

    const blockMedians = entries.map((entry) => entry.metrics.addedDelayMs.p50)
    expect(report.addedDelayMs?.p50).toBe(45)
    expect(referencePercentile(blockMedians, 50)).toBe(0)

    const pooled = bundles.flatMap((bundle) => delaysOf(policy, bundle))
    expect(report.addedDelayMs).toEqual({
      p10: referencePercentile(pooled, 10),
      p50: referencePercentile(pooled, 50),
      p90: referencePercentile(pooled, 90),
      p95: referencePercentile(pooled, 95),
      max: referencePercentile(pooled, 100),
    })
    expect(report.transactions.included).toBe(pooled.length)
  })

  it('reports the delay of the transactions the policy held, apart from everyone else', () => {
    // A class policy holds a few transactions in a large block: over everyone the
    // percentiles sit at zero, and only the held ones say how long the class waited.
    const policy = bump(45)
    const bundles = [blockOf(10, 200, 50), blockOf(11, 120, 60), blockOf(12, 6, 99)]
    const report = batchReport(
      policyHash(policy),
      bundles.map((bundle) => entryOf(policy, bundle)),
    )

    const held = bundles.flatMap((bundle) => delaysOf(policy, bundle)).filter((ms) => ms > 0)
    expect(report.addedDelayMs?.p95).toBe(0)
    expect(report.heldDelayMs).toEqual({
      p10: referencePercentile(held, 10),
      p50: referencePercentile(held, 50),
      p90: referencePercentile(held, 90),
      p95: referencePercentile(held, 95),
      max: referencePercentile(held, 100),
    })
    expect(report.heldDelayMs?.p10).toBeGreaterThan(0)
    expect(report.transactions.delayed).toBe(held.length)
  })

  it('has no held-delay distribution when the policy held nobody', () => {
    const report = batchReport(policyHash(deny), [entryOf(deny, blockOf(1, 8))])

    expect(report.addedDelayMs).toEqual({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })
    expect(report.heldDelayMs).toBeNull()
  })

  it('names the sample beside the numbers: blocks, which slots, and transaction totals', () => {
    const policy = bump(100)
    const bundles = [blockOf(30, 8), blockOf(20, 8)]
    const entries = bundles.map((bundle) => entryOf(policy, bundle))
    const report = batchReport(policyHash(policy), entries)

    expect(report.policyHash).toBe(policyHash(policy))
    expect(report.blocks).toBe(2)
    expect(report.slots).toEqual([20, 30])

    const sum = (field: 'recorded' | 'included' | 'deferred' | 'dropped' | 'moved' | 'delayed') =>
      entries.reduce((total, entry) => total + entry.metrics[field], 0)
    expect(report.transactions).toEqual({
      recorded: sum('recorded'),
      included: sum('included'),
      deferred: sum('deferred'),
      dropped: sum('dropped'),
      moved: sum('moved'),
      delayed: sum('delayed'),
    })
    // The 100 ms bump pushes index 6 (arrival 300 ms) to the slot boundary in each block.
    expect(report.transactions.deferred).toBe(2)
  })

  it('reports per-block shares as distributions over blocks, in parts per thousand', () => {
    // Deny on every third of 9 drops 3 (333 ‰); on every second of 8 drops 4 (500 ‰);
    // on every fourth of 7 drops 2 (285 ‰ — floored, never rounded up).
    const bundles = [blockOf(1, 9, 3), blockOf(2, 8, 2), blockOf(3, 7, 4)]
    const report = batchReport(
      policyHash(deny),
      bundles.map((bundle) => entryOf(deny, bundle)),
    )

    expect(report.perBlock.droppedPerMille).toEqual({
      p10: 285,
      p50: 333,
      p90: 500,
      p95: 500,
      max: 500,
    })
    expect(report.perBlock.deferredPerMille).toEqual({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })
    expect(report.perBlock.reorderedPerMille).toEqual({ p10: 0, p50: 0, p90: 0, p95: 0, max: 0 })
  })

  it('distributes the run’s own reordered share over blocks', () => {
    const policy = bump(60)
    const bundles = [blockOf(1, 8), blockOf(2, 16, 4), blockOf(3, 9, 3)]
    const entries = bundles.map((bundle) => entryOf(policy, bundle))
    const report = batchReport(policyHash(policy), entries)

    const shares = entries.map((entry) => entry.metrics.reorderedPerMille)
    expect(report.perBlock.reorderedPerMille).toEqual({
      p10: referencePercentile(shares, 10),
      p50: referencePercentile(shares, 50),
      p90: referencePercentile(shares, 90),
      p95: referencePercentile(shares, 95),
      max: referencePercentile(shares, 100),
    })
  })

  it('counts triples found, broken and still possible, and who broke them', () => {
    const policy = bump(60)
    const report = batchReport(policyHash(policy), [
      entryOf(policy, blockOf(1, 8), [BROKEN_BY_BUMP, STILL_POSSIBLE]),
      entryOf(policy, blockOf(2, 8), []),
      entryOf(policy, blockOf(3, 8), [BROKEN_BY_BUMP, BROKEN_BY_DENY, BROKEN_BY_BUMP]),
      entryOf(policy, blockOf(4, 8), [{ broken: true, reason: 'sameBatch', by: null }]),
    ])

    expect(report.triples).toEqual({
      found: 6,
      broken: 5,
      possible: 1,
      byPrimitive: { speedBump: 3, batchAuction: 0, allowDeny: 1, unattributed: 1 },
      byReason: { legLeftBlock: 1, victimsLeftBlock: 0, sameBatch: 1, orderChanged: 3 },
    })
    expect(report.perBlock.triples).toEqual({ p10: 0, p50: 1, p90: 3, p95: 3, max: 3 })
  })

  it('counts blocks the policy left exactly as recorded', () => {
    const policy = bump(60)
    // Every signer is the victim, so the bump on the attacker selects nothing.
    const untouched: SlotBundle = {
      ...bundleOf([0, 1, 2].map((index) => tx(index, { signers: [VICTIM] }))),
      slot: 2,
    }
    const report = batchReport(policyHash(policy), [
      entryOf(policy, blockOf(1, 8)),
      entryOf(policy, untouched),
    ])

    expect(report.unchangedBlocks).toBe(1)
  })

  it('does not depend on the order the runs finished in', () => {
    const policy = bump(45)
    const entries = [blockOf(10, 8), blockOf(11, 23, 3), blockOf(12, 5)].map((bundle, slot) =>
      entryOf(policy, bundle, slot === 1 ? [BROKEN_BY_BUMP, STILL_POSSIBLE] : []),
    )

    const forwards = canonicalize(batchReport(policyHash(policy), entries))
    const backwards = canonicalize(batchReport(policyHash(policy), [...entries].reverse()))
    expect(backwards).toBe(forwards)
  })

  it('produces a byte-identical report on every one of 50 runs', () => {
    const policy = bump(45)
    const entries = [blockOf(10, 8), blockOf(11, 23, 3)].map((bundle) => entryOf(policy, bundle))
    const results = new Set<string>()

    for (let attempt = 0; attempt < 50; attempt += 1) {
      results.add(canonicalize(batchReport(policyHash(policy), entries)))
    }

    expect(results.size).toBe(1)
  })

  it('has no distributions at all for a batch with no finished runs', () => {
    // Cancelled before the first slot: zeros would be a statement about blocks nobody ran.
    const report = batchReport(policyHash(deny), [])

    expect(report.blocks).toBe(0)
    expect(report.slots).toEqual([])
    expect(report.addedDelayMs).toBeNull()
    expect(report.heldDelayMs).toBeNull()
    expect(report.perBlock).toEqual({
      reorderedPerMille: null,
      deferredPerMille: null,
      droppedPerMille: null,
      triples: null,
    })
    expect(report.triples.found).toBe(0)
    expect(report.unchangedBlocks).toBe(0)
  })

  it('has no delay distribution when the policy left no transaction in any block', () => {
    const everyone = policyOf({
      kind: 'allowDeny',
      rules: [{ effect: 'deny', match: { match: 'signer', signers: [ATTACKER, VICTIM] } }],
    })
    const report = batchReport(policyHash(everyone), [entryOf(everyone, blockOf(1, 8))])

    expect(report.transactions.included).toBe(0)
    expect(report.addedDelayMs).toBeNull()
    expect(report.perBlock.droppedPerMille?.p50).toBe(1000)
  })

  it('refuses a slot counted twice', () => {
    const policy = bump(60)
    const entry = entryOf(policy, blockOf(1, 8))
    expect(() => batchReport(policyHash(policy), [entry, entry])).toThrow(/slot 1/)
  })

  it('refuses a run of a different policy', () => {
    expect(() => batchReport(policyHash(deny), [entryOf(bump(60), blockOf(1, 8))])).toThrow(
      /policy/,
    )
  })
})
