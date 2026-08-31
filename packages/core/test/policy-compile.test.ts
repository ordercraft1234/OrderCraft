import { describe, expect, it } from 'vitest'
import { canonicalize, policyHash } from '../src/policy/compile.ts'

describe('canonicalize', () => {
  it('ignores the order keys were written in', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
  })

  it('keeps array order, because a policy is a sequence', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('emits keys sorted by code point, without whitespace', () => {
    expect(canonicalize({ delayMs: 120, kind: 'speedBump', Applies: 'x' })).toBe(
      '{"Applies":"x","delayMs":120,"kind":"speedBump"}',
    )
  })

  it('refuses a fractional number — a policy parameter that is not an integer is a bug upstream', () => {
    expect(() => canonicalize({ delayMs: 12.5 })).toThrow(/integer/)
  })

  it('refuses values JSON cannot round-trip', () => {
    expect(() => canonicalize({ at: undefined })).toThrow(/undefined/)
    expect(() => canonicalize({ at: 10n })).toThrow(/bigint/)
    expect(() => canonicalize({ at: Number.NaN })).toThrow(/integer/)
  })

  it('escapes strings the way JSON does', () => {
    expect(canonicalize({ name: 'a"b\\c\nd' })).toBe('{"name":"a\\"b\\\\c\\nd"}')
  })

  it('keeps non-ASCII text as itself', () => {
    expect(canonicalize({ name: 'Ç' })).toBe('{"name":"Ç"}')
  })
})

describe('policyHash', () => {
  const policy = {
    schemaVersion: 1,
    name: 'Anti-snipe launch',
    steps: [
      { kind: 'speedBump', delayMs: 120 },
      { kind: 'batchAuction', windowMs: 250 },
    ],
  }

  it('is stable across calls and across key order', () => {
    const reordered = {
      steps: [
        { delayMs: 120, kind: 'speedBump' },
        { windowMs: 250, kind: 'batchAuction' },
      ],
      name: 'Anti-snipe launch',
      schemaVersion: 1,
    }

    expect(policyHash(policy)).toBe(policyHash(policy))
    expect(policyHash(reordered)).toBe(policyHash(policy))
  })

  it('is 64 lower-case hex characters', () => {
    expect(policyHash(policy)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a parameter changes', () => {
    const slower = { ...policy, steps: [{ kind: 'speedBump', delayMs: 121 }] }

    expect(policyHash(slower)).not.toBe(policyHash(policy))
  })

  it('changes when the steps are reordered', () => {
    const swapped = { ...policy, steps: [...policy.steps].reverse() }

    expect(policyHash(swapped)).not.toBe(policyHash(policy))
  })

  it('is the SHA-256 of the canonical text, hashed as UTF-8', () => {
    // sha256('{"a":1}') and sha256('{"name":"Ç"}') — taken from an independent
    // implementation, so a change of hashing library cannot pass unnoticed.
    expect(policyHash({ a: 1 })).toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    )
    expect(policyHash({ name: 'Ç' })).toBe(
      'bd5d6a15a0e71b4c9f6c3cefdfb1415023bc1a3072efc9dab3c5d35a28e30509',
    )
  })
})
