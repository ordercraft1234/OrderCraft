import { POLICY_SCHEMA_VERSION, type Policy, policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { demoDraft } from '../src/lib/demoPolicy.ts'
import { policyToDraft, toPolicy } from '../src/lib/policyDraft.ts'

/**
 * A link names a policy by the hash of its canonical body. Opening the link puts that
 * body in the builder, and the builder offers to save what it holds — so if reading a
 * policy back changed it in any way, the screen would offer a different policy under
 * the address that brought somebody there.
 *
 * These tests compare hashes and bodies, not shapes: the hash is what the link is.
 */
const WSOL = 'So11111111111111111111111111111111111111112'
const SIGNERS = [
  '83TSSS7qojPowqrrvH23mCrhEJjnJG2ygaf7FEq9ZgKC',
  'FTp1BybZ51NiZKbnZH6MsrV3tUZNauhpQMbBcqYUEr5f',
]
const PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const ACCOUNT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

/** One policy touching every branch a selector and a step can take. */
const EVERY_BRANCH: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'Every branch',
  steps: [
    { kind: 'speedBump', delayMs: 0, appliesTo: { match: 'all' } },
    { kind: 'speedBump', delayMs: 400, appliesTo: { match: 'program', programs: [PROGRAM] } },
    {
      kind: 'batchAuction',
      windowMs: 250,
      appliesTo: { match: 'tokenDeltaAbove', mint: WSOL, amount: '500000000' },
    },
    {
      kind: 'allowDeny',
      rules: [
        { effect: 'deny', match: { match: 'signer', signers: SIGNERS } },
        { effect: 'prioritise', match: { match: 'account', accounts: [ACCOUNT] } },
      ],
    },
  ],
}

function roundTrip(policy: Policy): Policy {
  const parsed = toPolicy(policyToDraft(policy))
  if (!parsed.ok) throw new Error(`the draft did not compile: ${parsed.errors[0]?.message}`)

  return parsed.policy
}

describe('policyToDraft', () => {
  it('returns the demo policy unchanged, hash and all', () => {
    const parsed = toPolicy(demoDraft())
    if (!parsed.ok) throw new Error('the demo policy does not compile')

    expect(roundTrip(parsed.policy)).toEqual(parsed.policy)
    expect(policyHash(roundTrip(parsed.policy))).toBe(policyHash(parsed.policy))
  })

  it('returns a policy using every selector and every step unchanged', () => {
    expect(roundTrip(EVERY_BRANCH)).toEqual(EVERY_BRANCH)
    expect(policyHash(roundTrip(EVERY_BRANCH))).toBe(policyHash(EVERY_BRANCH))
  })

  it('keeps each step to the fields its own branch carries', () => {
    const draft = policyToDraft(EVERY_BRANCH)
    const [all, program, batch, rules] = draft.steps

    // An address list is one box of text; a threshold is two other boxes. Whichever
    // the branch does not use comes back empty rather than carrying something the
    // stored body never said.
    expect(all).toEqual({
      kind: 'speedBump',
      delayMs: '0',
      appliesTo: { match: 'all', addresses: '', mint: '', amount: '' },
    })
    expect(program?.kind === 'speedBump' && program.appliesTo.addresses).toBe(PROGRAM)
    expect(batch?.kind === 'batchAuction' && batch.appliesTo.amount).toBe('500000000')
    expect(batch?.kind === 'batchAuction' && batch.appliesTo.addresses).toBe('')
    expect(rules?.kind === 'allowDeny' && rules.rules[0]?.match.addresses).toBe(SIGNERS.join('\n'))
  })

  /**
   * `addressList` splits on newlines, so the join has to be the same character. A
   * comma-joined list would read back as one impossible address and the round trip
   * would fail at the schema rather than silently — but it would fail after somebody
   * opened a link, which is too late for a difference this cheap to test.
   */
  it('joins addresses the way the editor splits them', () => {
    const draft = policyToDraft(EVERY_BRANCH)
    const step = draft.steps[3]
    if (step?.kind !== 'allowDeny') throw new Error('expected the allow/deny step')

    expect(step.rules[0]?.match.addresses.split('\n')).toEqual(SIGNERS)
  })
})
