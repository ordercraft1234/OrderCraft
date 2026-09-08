import { policyHash } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import {
  type PolicyDraft,
  addStep,
  addressList,
  emptySelector,
  errorsFor,
  moveStep,
  newDraft,
  removeStep,
  toPolicy,
  updateStep,
} from '../src/lib/policyDraft.ts'

const ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OTHER_ADDRESS = 'So11111111111111111111111111111111111111112'

function draftOf(...steps: PolicyDraft['steps']): PolicyDraft {
  return { name: 'Test policy', steps }
}

describe('toPolicy', () => {
  it('turns a new draft into a policy', () => {
    const result = toPolicy(newDraft())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.policy.steps).toEqual([
      { kind: 'speedBump', delayMs: 120, appliesTo: { match: 'all' } },
    ])
  })

  it('refuses a parameter that is not plain digits', () => {
    // Every one of these is a number to `Number`, and a builder that used it would
    // hash a policy the person did not write.
    for (const typed of ['', ' ', '12a', '1e2', '12.0', '-5', '0x10']) {
      const result = toPolicy(
        draftOf({ kind: 'speedBump', delayMs: typed, appliesTo: emptySelector('all') }),
      )

      expect(result.ok, `accepted ${JSON.stringify(typed)}`).toBe(false)
      if (result.ok) continue
      expect(errorsFor(result.errors, 'steps.0.delayMs')).toHaveLength(1)
    }
  })

  it('reports an out-of-range parameter against the schema range', () => {
    const result = toPolicy(
      draftOf({ kind: 'speedBump', delayMs: '401', appliesTo: emptySelector('all') }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(errorsFor(result.errors, 'steps.0.delayMs')).toHaveLength(1)
  })

  it('puts an address complaint on the selector, not on a field that is not drawn', () => {
    const result = toPolicy(
      draftOf({
        kind: 'speedBump',
        delayMs: '120',
        appliesTo: { ...emptySelector('signer'), addresses: `${ADDRESS}\nnot-base58` },
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    // `not-base58` is both too short and not base58, so the schema reports two
    // complaints — both belong on the selector box, which is the point here.
    const onSelector = errorsFor(result.errors, 'steps.0.appliesTo')
    expect(onSelector.length).toBeGreaterThan(0)
    expect(onSelector.some((error) => error.message.includes('base58'))).toBe(true)
    expect(errorsFor(result.errors, 'steps.0.delayMs')).toHaveLength(0)
  })

  it('puts a rule complaint on its own row', () => {
    const result = toPolicy(
      draftOf({
        kind: 'allowDeny',
        rules: [
          { effect: 'deny', match: { ...emptySelector('signer'), addresses: ADDRESS } },
          { effect: 'deny', match: { ...emptySelector('signer'), addresses: 'nope' } },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(errorsFor(result.errors, 'steps.0.rules.1')).toHaveLength(1)
    expect(errorsFor(result.errors, 'steps.0.rules.0')).toHaveLength(0)
  })

  it('reports an empty policy on the step list', () => {
    const result = toPolicy(draftOf())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(errorsFor(result.errors, 'steps')).toHaveLength(1)
  })

  it('keeps a token amount as the string the schema expects', () => {
    const result = toPolicy(
      draftOf({
        kind: 'speedBump',
        delayMs: '120',
        appliesTo: { match: 'tokenDeltaAbove', addresses: '', mint: ADDRESS, amount: '5000000000' },
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.policy.steps[0]).toEqual({
      kind: 'speedBump',
      delayMs: 120,
      appliesTo: { match: 'tokenDeltaAbove', mint: ADDRESS, amount: '5000000000' },
    })
  })

  it('ignores blank lines between addresses', () => {
    expect(addressList(` ${ADDRESS} \n\n${OTHER_ADDRESS}\n`)).toEqual([ADDRESS, OTHER_ADDRESS])
  })
})

describe('editing', () => {
  it('adds a step of each kind and keeps the draft valid', () => {
    let draft = newDraft()
    draft = addStep(draft, 'batchAuction')

    const result = toPolicy(draft)
    expect(result.ok).toBe(true)
    expect(draft.steps.map((step) => step.kind)).toEqual(['speedBump', 'batchAuction'])
  })

  it('moves a step and changes the policy hash with it', () => {
    const draft = addStep(newDraft(), 'batchAuction')
    const moved = moveStep(draft, 0, 1)

    expect(moved.steps.map((step) => step.kind)).toEqual(['batchAuction', 'speedBump'])

    const before = toPolicy(draft)
    const after = toPolicy(moved)
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok) return
    // Order is part of the policy, so it has to be part of its content address.
    expect(policyHash(before.policy)).not.toBe(policyHash(after.policy))
  })

  it('refuses to move a step off either end', () => {
    const draft = addStep(newDraft(), 'batchAuction')

    expect(moveStep(draft, 0, -1)).toEqual(draft)
    expect(moveStep(draft, 1, 1)).toEqual(draft)
  })

  it('removes a step by position', () => {
    const draft = addStep(newDraft(), 'batchAuction')

    expect(removeStep(draft, 0).steps.map((step) => step.kind)).toEqual(['batchAuction'])
  })

  it('leaves the draft alone when the position does not exist', () => {
    const draft = newDraft()

    expect(
      updateStep(draft, 4, { kind: 'batchAuction', windowMs: '250', appliesTo: emptySelector() }),
    ).toEqual(draft)
    expect(removeStep(draft, 4)).toEqual(draft)
  })

  it('keeps what was typed when the selector kind changes', () => {
    const selector = { ...emptySelector('signer'), addresses: ADDRESS, mint: 'm', amount: '1' }

    // The draft carries every branch's fields at once precisely so that switching
    // away and back does not silently empty the box.
    expect({ ...selector, match: 'account' as const }.addresses).toBe(ADDRESS)
  })
})
