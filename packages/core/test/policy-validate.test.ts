import { describe, expect, it } from 'vitest'
import type { Policy } from '../src/policy/schema.ts'
import { validatePolicy } from '../src/policy/validate.ts'

const SIGNER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const OTHER = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'

const policy = (steps: Policy['steps']): Policy => ({
  schemaVersion: 1,
  name: 'test',
  steps,
})

const codes = (result: ReturnType<typeof validatePolicy>) => result.issues.map((i) => i.code)

describe('validatePolicy', () => {
  it('passes a policy that does something', () => {
    const result = validatePolicy(
      policy([
        { kind: 'speedBump', delayMs: 120, appliesTo: { match: 'signer', signers: [SIGNER] } },
        { kind: 'batchAuction', windowMs: 250, appliesTo: { match: 'all' } },
      ]),
    )

    expect(result.issues).toEqual([])
    expect(result.runnable).toBe(true)
  })

  it('refuses a second batch auction', () => {
    const result = validatePolicy(
      policy([
        { kind: 'batchAuction', windowMs: 250, appliesTo: { match: 'all' } },
        { kind: 'batchAuction', windowMs: 100, appliesTo: { match: 'all' } },
      ]),
    )

    expect(codes(result)).toContain('duplicate-batch-auction')
    expect(result.runnable).toBe(false)
  })

  it('refuses a rule that denies the whole block', () => {
    const result = validatePolicy(
      policy([{ kind: 'allowDeny', rules: [{ effect: 'deny', match: { match: 'all' } }] }]),
    )

    expect(codes(result)).toContain('denies-everything')
    expect(result.runnable).toBe(false)
  })

  it('refuses the same selector being both prioritised and denied', () => {
    const result = validatePolicy(
      policy([
        {
          kind: 'allowDeny',
          rules: [
            { effect: 'deny', match: { match: 'signer', signers: [SIGNER] } },
            { effect: 'prioritise', match: { match: 'signer', signers: [SIGNER] } },
          ],
        },
      ]),
    )

    expect(codes(result)).toContain('contradictory-rules')
    expect(result.runnable).toBe(false)
  })

  it('warns about a speed bump that holds nothing', () => {
    const result = validatePolicy(
      policy([{ kind: 'speedBump', delayMs: 0, appliesTo: { match: 'all' } }]),
    )

    expect(codes(result)).toEqual(['no-op-speed-bump'])
    expect(result.runnable).toBe(true)
  })

  it('warns about two speed bumps on the same class', () => {
    const result = validatePolicy(
      policy([
        { kind: 'speedBump', delayMs: 80, appliesTo: { match: 'signer', signers: [SIGNER] } },
        { kind: 'speedBump', delayMs: 40, appliesTo: { match: 'signer', signers: [SIGNER] } },
      ]),
    )

    expect(codes(result)).toContain('overlapping-speed-bumps')
    expect(result.runnable).toBe(true)
  })

  it('does not confuse selectors that differ only by list order', () => {
    const result = validatePolicy(
      policy([
        {
          kind: 'speedBump',
          delayMs: 80,
          appliesTo: { match: 'signer', signers: [SIGNER, OTHER] },
        },
        {
          kind: 'speedBump',
          delayMs: 40,
          appliesTo: { match: 'signer', signers: [OTHER, SIGNER] },
        },
      ]),
    )

    expect(codes(result)).toContain('overlapping-speed-bumps')
  })

  it('warns about a repeated address in one selector', () => {
    const result = validatePolicy(
      policy([
        {
          kind: 'speedBump',
          delayMs: 80,
          appliesTo: { match: 'signer', signers: [SIGNER, SIGNER] },
        },
      ]),
    )

    expect(codes(result)).toContain('repeated-address')
  })

  it('points every issue at the step it came from', () => {
    const result = validatePolicy(
      policy([
        { kind: 'speedBump', delayMs: 120, appliesTo: { match: 'all' } },
        { kind: 'batchAuction', windowMs: 250, appliesTo: { match: 'all' } },
        { kind: 'batchAuction', windowMs: 100, appliesTo: { match: 'all' } },
      ]),
    )

    expect(result.issues[0]).toMatchObject({ code: 'duplicate-batch-auction', step: 2 })
  })
})
