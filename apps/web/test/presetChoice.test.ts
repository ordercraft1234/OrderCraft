import { PRESETS, WSOL_MINT } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { fieldChangeLine, isUnsaved, recordable, stepSummary } from '../src/lib/presetChoice.ts'

describe('stepSummary', () => {
  it('reads each shipped preset as a line per step', () => {
    expect(PRESETS.map((preset) => preset.policy.steps.map(stepSummary))).toStrictEqual([
      ['speed bump 120 ms on 3 programs', 'batch auction 250 ms on 3 programs'],
      ['prioritise 3 programs'],
      ['batch auction 200 ms on moves above 1 wSOL'],
    ])
  })

  it('names a class the way the selector does', () => {
    expect(stepSummary({ kind: 'speedBump', delayMs: 40, appliesTo: { match: 'all' } })).toBe(
      'speed bump 40 ms on the whole block',
    )
    expect(
      stepSummary({
        kind: 'allowDeny',
        rules: [
          { effect: 'deny', match: { match: 'signer', signers: [WSOL_MINT] } },
          { effect: 'prioritise', match: { match: 'account', accounts: [WSOL_MINT, WSOL_MINT] } },
        ],
      }),
    ).toBe('deny 1 signer · prioritise 2 accounts')
  })

  /** The slot carries no decimals, so only the one mint whose decimals we know is scaled. */
  it('scales wSOL and leaves every other mint in base units', () => {
    const on = (mint: string, amount: string) =>
      stepSummary({
        kind: 'batchAuction',
        windowMs: 100,
        appliesTo: { match: 'tokenDeltaAbove', mint, amount },
      })

    expect(on(WSOL_MINT, '500000000')).toBe('batch auction 100 ms on moves above 0.5 wSOL')
    expect(on(WSOL_MINT, '1')).toBe('batch auction 100 ms on moves above 0.000000001 wSOL')
    expect(on('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '100000000')).toBe(
      'batch auction 100 ms on moves above 100000000 base units of EPjF…Dt1v',
    )
  })
})

describe('fieldChangeLine', () => {
  it('prints each kind of change with both sides', () => {
    expect(fieldChangeLine({ field: 'delayMs', preset: 120, policy: 200 })).toBe(
      'delayMs 120 → 200 ms',
    )
    expect(
      fieldChangeLine({
        field: 'appliesTo',
        preset: { match: 'all' },
        policy: { match: 'tokenDeltaAbove', mint: WSOL_MINT, amount: '2000000000' },
      }),
    ).toBe('class the whole block → moves above 2 wSOL')
    expect(
      fieldChangeLine({
        field: 'rule',
        rule: 1,
        preset: null,
        policy: { effect: 'deny', match: { match: 'signer', signers: [WSOL_MINT] } },
      }),
    ).toBe('rule 2: none → deny 1 signer')
  })
})

describe('recordable', () => {
  it('passes a shipped preset through', () => {
    expect(recordable('anti-snipe-launch')).toBe('anti-snipe-launch')
  })

  it('drops an origin this build does not ship, and the absence of one', () => {
    expect(recordable('fair-launch')).toBeNull()
    expect(recordable(null)).toBeNull()
  })
})

describe('isUnsaved', () => {
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  it('is false for what the app last put on screen, untouched', () => {
    expect(isUnsaved({ draftHash: A, baselineHash: A, stored: false })).toBe(false)
  })

  it('is true once the draft has moved away from it', () => {
    expect(isUnsaved({ draftHash: B, baselineHash: A, stored: false })).toBe(true)
  })

  it('is false when the edit is already stored and has a link', () => {
    expect(isUnsaved({ draftHash: B, baselineHash: A, stored: true })).toBe(false)
  })

  /** A half-typed draft has no hash, and it is exactly what a replacement would lose. */
  it('is true for a draft that is not yet a policy', () => {
    expect(isUnsaved({ draftHash: null, baselineHash: A, stored: false })).toBe(true)
  })
})
