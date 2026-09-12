import { describe, expect, it } from 'vitest'
import type { Sandwich } from '../src/detect/sandwich.ts'
import { extractedValue } from '../src/metrics/extracted.ts'
import { ATTACKER, MINT, POOL, QUOTE, VICTIM, bundleOf, tx } from './helpers/build.ts'

const sandwich: Sandwich = {
  front: 0,
  victims: [1],
  back: 2,
  signer: ATTACKER,
  mint: QUOTE,
  pool: POOL,
}

function triple(front: Partial<Parameters<typeof tx>[1]>, back: Partial<Parameters<typeof tx>[1]>) {
  return bundleOf([
    tx(0, front),
    tx(1, { signers: [VICTIM], accounts: [VICTIM, POOL] }),
    tx(2, back),
  ])
}

describe('extractedValue', () => {
  it('nets the attacker own balances across the triple', () => {
    const bundle = triple(
      { tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: -1000n }] },
      { tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: 1200n }] },
    )

    expect(extractedValue(bundle, sandwich).tokens).toStrictEqual([{ mint: QUOTE, amount: 200n }])
  })

  it('leaves everybody else out of it', () => {
    const bundle = triple(
      {
        tokenDelta: [
          { owner: ATTACKER, mint: QUOTE, amount: -1000n },
          { owner: POOL, mint: QUOTE, amount: 1000n },
        ],
      },
      { tokenDelta: [{ owner: POOL, mint: QUOTE, amount: -1200n }] },
    )

    expect(extractedValue(bundle, sandwich).tokens).toStrictEqual([{ mint: QUOTE, amount: -1000n }])
  })

  it('drops a mint that came back to where it started', () => {
    const bundle = triple(
      { tokenDelta: [{ owner: ATTACKER, mint: MINT, amount: 500n }] },
      { tokenDelta: [{ owner: ATTACKER, mint: MINT, amount: -500n }] },
    )

    expect(extractedValue(bundle, sandwich).tokens).toStrictEqual([])
  })

  /**
   * The fee is taken from the payer before the post balance is written, so it is
   * already inside the lamport delta. FR-025 asks for the net after fees; subtracting
   * `fee` here as well would charge the attacker twice and turn a profitable triple
   * into a loss on screen.
   */
  it('does not subtract a fee that the balance already paid', () => {
    const bundle = triple(
      { fee: 5000n, lamportDelta: { [ATTACKER]: -1_005_000n } },
      { fee: 5000n, lamportDelta: { [ATTACKER]: 1_200_000n } },
    )
    const value = extractedValue(bundle, sandwich)

    expect(value.lamports).toBe(195_000n)
    expect(value.fees).toBe(10_000n)
  })

  it('counts what the attacker moved in the victim transaction too', () => {
    const bundle = bundleOf([
      tx(0, { tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: -1000n }] }),
      tx(1, {
        signers: [VICTIM],
        accounts: [VICTIM, POOL],
        tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: 50n }],
      }),
      tx(2, { tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: 1200n }] }),
    ])

    expect(extractedValue(bundle, sandwich).tokens).toStrictEqual([{ mint: QUOTE, amount: 250n }])
  })

  it('orders mints so two runs cannot print them differently', () => {
    const bundle = triple(
      {
        tokenDelta: [
          { owner: ATTACKER, mint: QUOTE, amount: -1000n },
          { owner: ATTACKER, mint: MINT, amount: 700n },
        ],
      },
      { tokenDelta: [{ owner: ATTACKER, mint: QUOTE, amount: 1200n }] },
    )

    expect(extractedValue(bundle, sandwich).tokens.map((token) => token.mint)).toStrictEqual(
      [MINT, QUOTE].sort(),
    )
  })
})
