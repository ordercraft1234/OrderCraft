import { describe, expect, it } from 'vitest'
import { apply } from '../src/order/apply.ts'
import { POLICY_SCHEMA_VERSION, type Policy } from '../src/policy/schema.ts'
import { ATTACKER, VICTIM, VOTE, bundleOf, tx } from './helpers/build.ts'

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

const order = (policy: Policy) => apply(policy, bundle).included.map((placement) => placement.index)

describe('apply', () => {
  it('leaves the recorded order alone when no step moves anything', () => {
    expect(order(policyOf({ kind: 'speedBump', delayMs: 0, appliesTo: { match: 'all' } }))).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7],
    )
  })

  it('reorders by the clock a step changed', () => {
    // Attackers are the even indices, arriving 50 ms ahead of the victim behind them;
    // a 60 ms bump puts each of them one place later.
    const reordered = order(
      policyOf({
        kind: 'speedBump',
        delayMs: 60,
        appliesTo: { match: 'signer', signers: [ATTACKER] },
      }),
    )

    expect(reordered).toEqual([1, 0, 3, 2, 5, 4, 7, 6])
  })

  it('puts a prioritised class ahead of everything, whatever the clock says', () => {
    const reordered = order(
      policyOf({
        kind: 'allowDeny',
        rules: [{ effect: 'prioritise', match: { match: 'signer', signers: [VICTIM] } }],
      }),
    )

    expect(reordered).toEqual([1, 3, 5, 7, 0, 2, 4, 6])
  })

  it('runs steps in the order they were written, each seeing the last one', () => {
    const bumpThenBatch = order(
      policyOf(
        { kind: 'speedBump', delayMs: 60, appliesTo: { match: 'signer', signers: [ATTACKER] } },
        { kind: 'batchAuction', windowMs: 100, appliesTo: { match: 'all' } },
      ),
    )
    const batchThenBump = order(
      policyOf(
        { kind: 'batchAuction', windowMs: 100, appliesTo: { match: 'all' } },
        { kind: 'speedBump', delayMs: 60, appliesTo: { match: 'signer', signers: [ATTACKER] } },
      ),
    )

    expect(bumpThenBatch).not.toEqual(batchThenBump)
  })

  it('separates what the policy left out, in recorded order', () => {
    const result = apply(
      policyOf({
        kind: 'allowDeny',
        rules: [{ effect: 'deny', match: { match: 'signer', signers: [ATTACKER] } }],
      }),
      bundle,
    )

    expect(result.included.map((placement) => placement.index)).toEqual([1, 3, 5, 7])
    expect(result.excluded.map((placement) => placement.index)).toEqual([0, 2, 4, 6])
    expect(result.excluded.every((placement) => placement.status === 'dropped')).toBe(true)
  })

  it('keeps deferred and dropped apart in the same excluded list', () => {
    const result = apply(
      policyOf(
        { kind: 'speedBump', delayMs: 100, appliesTo: { match: 'signer', signers: [VICTIM] } },
        {
          kind: 'allowDeny',
          rules: [{ effect: 'deny', match: { match: 'program', programs: [VOTE] } }],
        },
      ),
      bundleOf([
        tx(0, { signers: [ATTACKER] }),
        tx(1, { signers: [VICTIM] }),
        tx(2, { signers: [ATTACKER], programs: [VOTE], accounts: [ATTACKER, VOTE] }),
        tx(3, { signers: [VICTIM] }),
      ]),
    )

    // Index 3 arrives at 300 ms and a 100 ms bump takes it out of the block; index 2 was
    // refused. Both are excluded, for reasons the screen must not merge.
    expect(result.excluded.map((placement) => [placement.index, placement.status])).toEqual([
      [2, 'dropped'],
      [3, 'deferred'],
    ])
  })

  it('addresses the run by the policy hash and the slot', () => {
    const policy = policyOf({ kind: 'speedBump', delayMs: 25, appliesTo: { match: 'all' } })
    const result = apply(policy, bundle)

    expect(result.slot).toBe(bundle.slot)
    expect(result.policyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(apply(policy, bundle).policyHash).toBe(result.policyHash)
  })

  it('refuses to run a policy the validator called unrunnable', () => {
    const emptying = policyOf({
      kind: 'allowDeny',
      rules: [{ effect: 'deny', match: { match: 'all' } }],
    })

    expect(() => apply(emptying, bundle)).toThrow(/policy cannot be run/)
  })

  it('runs a policy whose only issues are warnings', () => {
    // A zero bump is a warning, not an error: it is pointless, not incoherent.
    expect(() =>
      apply(policyOf({ kind: 'speedBump', delayMs: 0, appliesTo: { match: 'all' } }), bundle),
    ).not.toThrow()
  })

  it('handles a slot with no transactions', () => {
    const result = apply(
      policyOf({ kind: 'speedBump', delayMs: 50, appliesTo: { match: 'all' } }),
      bundleOf([]),
    )

    expect(result.included).toEqual([])
    expect(result.excluded).toEqual([])
  })

  describe('total order', () => {
    it('falls back to the recorded position when priority and clock tie', () => {
      // One batch: every member settles at the same time, so only the tail of the key
      // can separate them.
      const batched = order(
        policyOf({ kind: 'batchAuction', windowMs: 350, appliesTo: { match: 'all' } }),
      )

      expect(batched).toEqual([0, 1, 2, 3, 4, 5, 6])
    })

    it('does not let a batch hand the earlier arrival its position back', () => {
      const result = apply(
        policyOf({
          kind: 'batchAuction',
          windowMs: 350,
          appliesTo: { match: 'all' },
        }),
        bundle,
      )

      expect(new Set(result.included.map((placement) => placement.timeMs)).size).toBe(1)
      expect(new Set(result.included.map((placement) => placement.batch)).size).toBe(1)
    })
  })
})
