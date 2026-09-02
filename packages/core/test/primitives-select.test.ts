import { describe, expect, it } from 'vitest'
import { matchesSelector } from '../src/primitives/select.ts'
import { AMM, ATTACKER, MINT, POOL, VICTIM, VOTE, tx } from './helpers/build.ts'

const OTHER_MINT = 'So11111111111111111111111111111111111111112'

describe('matchesSelector', () => {
  it('matches everything on `all`', () => {
    expect(matchesSelector({ match: 'all' }, tx(0))).toBe(true)
  })

  it('matches a program the transaction invokes', () => {
    expect(matchesSelector({ match: 'program', programs: [AMM] }, tx(0))).toBe(true)
    expect(matchesSelector({ match: 'program', programs: [VOTE] }, tx(0))).toBe(false)
  })

  it('matches any one of several listed programs', () => {
    expect(matchesSelector({ match: 'program', programs: [VOTE, AMM] }, tx(0))).toBe(true)
  })

  it('matches a signer, not merely an account', () => {
    const transaction = tx(0, { signers: [VICTIM], accounts: [VICTIM, ATTACKER, POOL] })

    expect(matchesSelector({ match: 'signer', signers: [VICTIM] }, transaction)).toBe(true)
    expect(matchesSelector({ match: 'signer', signers: [ATTACKER] }, transaction)).toBe(false)
    expect(matchesSelector({ match: 'account', accounts: [ATTACKER] }, transaction)).toBe(true)
  })

  describe('tokenDeltaAbove', () => {
    const moving = (amount: bigint) =>
      tx(0, { tokenDelta: [{ owner: ATTACKER, mint: MINT, amount }] })

    it('is about magnitude, so the sell side of a swap counts too', () => {
      const selector = { match: 'tokenDeltaAbove', mint: MINT, amount: '1000' } as const

      expect(matchesSelector(selector, moving(-5000n))).toBe(true)
      expect(matchesSelector(selector, moving(5000n))).toBe(true)
    })

    it('is strictly above the threshold', () => {
      const selector = { match: 'tokenDeltaAbove', mint: MINT, amount: '1000' } as const

      expect(matchesSelector(selector, moving(1000n))).toBe(false)
      expect(matchesSelector(selector, moving(1001n))).toBe(true)
    })

    it('ignores movement of a different mint', () => {
      const selector = { match: 'tokenDeltaAbove', mint: OTHER_MINT, amount: '1' } as const

      expect(matchesSelector(selector, moving(999999n))).toBe(false)
    })

    it('reads amounts past Number.MAX_SAFE_INTEGER without losing digits', () => {
      const selector = {
        match: 'tokenDeltaAbove',
        mint: MINT,
        amount: '9007199254740993',
      } as const

      expect(matchesSelector(selector, moving(9007199254740994n))).toBe(true)
      expect(matchesSelector(selector, moving(9007199254740993n))).toBe(false)
    })

    it('does not match a transaction that moved no tokens', () => {
      const selector = { match: 'tokenDeltaAbove', mint: MINT, amount: '0' } as const

      expect(matchesSelector(selector, tx(0))).toBe(false)
    })
  })
})
