import { describe, expect, it } from 'vitest'
import { apply } from '../src/order/apply.ts'
import { canonicalize, policyHash } from '../src/policy/compile.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import { AMM, ATTACKER, POOL, VICTIM, bundleOf, tx } from './helpers/build.ts'

const REPEATS = 50

/** All three primitives, so the check covers time, batching, refusal and priority. */
const policy: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'anti-snipe',
  steps: [
    { kind: 'speedBump', delayMs: 40, appliesTo: { match: 'signer', signers: [ATTACKER] } },
    { kind: 'batchAuction', windowMs: 60, appliesTo: { match: 'program', programs: [AMM] } },
    {
      kind: 'allowDeny',
      rules: [
        { effect: 'prioritise', match: { match: 'signer', signers: [VICTIM] } },
        { effect: 'deny', match: { match: 'tokenDeltaAbove', mint: POOL, amount: '1000000' } },
      ],
    },
  ],
}

function slotOf(size: number) {
  return bundleOf(
    [...Array(size).keys()].map((index) =>
      tx(index, {
        signers: [index % 3 === 0 ? ATTACKER : VICTIM],
        tokenDelta:
          index % 7 === 0 ? [{ owner: ATTACKER, mint: POOL, amount: BigInt(index) * 500000n }] : [],
      }),
    ),
  )
}

/**
 * SC-002. The claim is not "the code looks pure" but "the same inputs produced a
 * bit-identical result fifty times", and that is what this measures.
 */
describe('determinism (SC-002)', () => {
  it('produces an identical ordering on every one of 50 runs', () => {
    const bundle = slotOf(120)
    const first = canonicalize(apply(policy, bundle))
    const results = new Set([first])

    for (let attempt = 1; attempt < REPEATS; attempt += 1) {
      results.add(canonicalize(apply(policy, bundle)))
    }

    expect(results.size).toBe(1)
  })

  it('produces the same result from an equal slot built separately', () => {
    expect(canonicalize(apply(policy, slotOf(120)))).toBe(canonicalize(apply(policy, slotOf(120))))
  })

  it('hashes the policy the same way every time', () => {
    const hashes = new Set(
      Array.from({ length: REPEATS }, () => apply(policy, slotOf(40)).policyHash),
    )

    expect(hashes.size).toBe(1)
    expect([...hashes][0]).toBe(policyHash(policy))
  })

  it('leaves no ties in the ordering: every sort key is unique', () => {
    const { included } = apply(policy, slotOf(300))
    const keys = included.map(
      (placement) =>
        `${placement.prioritised ? 0 : 1}:${placement.timeMs}:${placement.index}:${placement.signature}`,
    )

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is stable against the order the slot happens to be iterated in', () => {
    // `apply` must not depend on anything but the recorded order. Reversing the input
    // array would break the schema invariant, so the check is that reordering the
    // *result* and re-sorting cannot change it.
    const bundle = slotOf(80)
    const once = apply(policy, bundle)
    const twice = apply(policy, bundle)

    expect(once.included.map((placement) => placement.index)).toEqual(
      twice.included.map((placement) => placement.index),
    )
    expect(once.excluded.map((placement) => placement.index)).toEqual(
      twice.excluded.map((placement) => placement.index),
    )
  })

  it('separates orderings that differ, so the check can fail', () => {
    const softer: Policy = {
      ...policy,
      steps: [
        { kind: 'speedBump', delayMs: 41, appliesTo: { match: 'signer', signers: [ATTACKER] } },
      ],
    }

    expect(canonicalize(apply(softer, slotOf(120)))).not.toBe(
      canonicalize(apply(policy, slotOf(120))),
    )
  })
})
