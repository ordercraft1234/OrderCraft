import { describe, expect, it } from 'vitest'
import { runMetrics } from '../src/metrics/run.ts'
import { apply } from '../src/order/apply.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import { AMM, ATTACKER, POOL, VICTIM, VOTE, bundleOf, tx } from './helpers/build.ts'

const SLOT_SIZE = 1500
const BUDGET_MS = 3000
const RUNS = 20

/**
 * Six steps — the ceiling a user is asked to build in SC-007, not a friendly minimum.
 * Only one batch auction: a second is an error the validator refuses, so six steps is
 * the widest legal policy to measure against.
 */
const policy: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'worst case',
  steps: [
    { kind: 'speedBump', delayMs: 15, appliesTo: { match: 'signer', signers: [ATTACKER] } },
    { kind: 'speedBump', delayMs: 25, appliesTo: { match: 'account', accounts: [POOL] } },
    { kind: 'batchAuction', windowMs: 50, appliesTo: { match: 'program', programs: [AMM] } },
    { kind: 'speedBump', delayMs: 10, appliesTo: { match: 'all' } },
    {
      kind: 'allowDeny',
      rules: [
        { effect: 'prioritise', match: { match: 'signer', signers: [VICTIM] } },
        { effect: 'deny', match: { match: 'tokenDeltaAbove', mint: POOL, amount: '900000000' } },
      ],
    },
    {
      kind: 'allowDeny',
      rules: [{ effect: 'deny', match: { match: 'program', programs: [VOTE] } }],
    },
  ],
}

const bundle = bundleOf(
  [...Array(SLOT_SIZE).keys()].map((index) =>
    tx(index, {
      signers: [index % 3 === 0 ? ATTACKER : VICTIM],
      tokenDelta:
        index % 5 === 0 ? [{ owner: ATTACKER, mint: POOL, amount: BigInt(index) * 700000n }] : [],
    }),
  ),
)

function percentile(ascending: number[], percent: number): number {
  const rank = Math.ceil((percent * ascending.length) / 100)
  return ascending[Math.min(Math.max(rank - 1, 0), ascending.length - 1)] ?? 0
}

/**
 * SC-001. The criterion is p95 over repeated runs, not a best case: a single fast run
 * says nothing about the run the user actually waits through.
 */
describe('performance (SC-001)', () => {
  it(`orders a ${SLOT_SIZE}-transaction slot well inside ${BUDGET_MS} ms at p95`, () => {
    const durations: number[] = []

    for (let attempt = 0; attempt < RUNS; attempt += 1) {
      const started = performance.now()
      runMetrics(bundle, apply(policy, bundle))
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)
    const p95 = percentile(durations, 95)

    // Printed so the milestone table can carry a measured number rather than a promise.
    console.log(
      `SC-001: ${SLOT_SIZE} tx, ${policy.steps.length} steps — p50 ${percentile(durations, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, budget ${BUDGET_MS} ms`,
    )

    expect(p95).toBeLessThan(BUDGET_MS)
  })

  it('actually ordered the slot it claims to have ordered', () => {
    // Guards the guard: a run that silently produced nothing would be very fast.
    const ordering = apply(policy, bundle)

    expect(ordering.included.length + ordering.excluded.length).toBe(SLOT_SIZE)
    expect(ordering.included.length).toBeGreaterThan(SLOT_SIZE / 2)
  })
})
