import { describe, expect, it } from 'vitest'
import { type Corpus, crossRoundTrips, linksBetween } from '../src/detect/related.ts'
import { findSandwiches } from '../src/detect/sandwich.ts'
import {
  AMM,
  ATTACKER,
  MINT,
  OTHER_POOL,
  OTHER_SIGNER,
  POOL,
  QUOTE,
  VICTIM,
  bundleOf,
  tx,
} from './helpers/build.ts'

/** A second wallet, and the bespoke program a two-wallet operator would drive. */
const SECOND_WALLET = OTHER_SIGNER
const BOT_PROGRAM = 'Bot1cV6xWq2sLcQ4dTgWmYaJ6uEzN3XqAcSdFgHjKlM'
const TREASURY = 'TreaSuRy4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey11'

/** One leg of a round trip, priced at the pool exactly as the other screens price one. */
function leg(
  index: number,
  signer: string,
  quote: bigint,
  token: bigint,
  pool: string = POOL,
): ReturnType<typeof tx> {
  return tx(index, {
    signers: [signer],
    accounts: [signer, pool, AMM],
    tokenDelta: [
      { owner: signer, mint: QUOTE, amount: quote },
      { owner: pool, mint: QUOTE, amount: -quote },
      { owner: pool, mint: MINT, amount: token },
    ],
  })
}

/** Pays 1,000 quote for 5,000 token; the other wallet takes 1,100 back for the same. */
const OPENS = [-1000n, -5000n] as const
const CLOSES = [1100n, 5000n] as const
const LOSES = [900n, 5000n] as const

function middle(index: number, quote = -300n, signer: string = VICTIM): ReturnType<typeof tx> {
  return tx(index, {
    signers: [signer],
    accounts: [signer, POOL],
    tokenDelta: [
      { owner: signer, mint: QUOTE, amount: quote },
      { owner: POOL, mint: QUOTE, amount: -quote },
      { owner: signer, mint: MINT, amount: -quote * 2n },
      { owner: POOL, mint: MINT, amount: quote * 2n },
    ],
  })
}

/** The pair the whole task is about: one wallet opens, another closes, in profit. */
const PAID = [
  tx(0),
  leg(1, ATTACKER, ...OPENS),
  middle(2),
  leg(3, SECOND_WALLET, ...CLOSES),
] as const

describe('crossRoundTrips — the pair of legs nobody has ever looked at', () => {
  it('finds a profitable round trip split over two wallets', () => {
    const [hit] = crossRoundTrips(bundleOf([...PAID]))

    expect(hit?.front).toBe(1)
    expect(hit?.back).toBe(3)
    expect(hit?.frontSigner).toBe(ATTACKER)
    expect(hit?.backSigner).toBe(SECOND_WALLET)
    expect(hit?.mint).toBe(QUOTE)
    expect(hit?.between).toEqual([2])
  })

  /**
   * The reason this module exists at all: every other filter here requires one signer on
   * both legs, so the block above is silent to all of them.
   */
  it('is invisible to the narrow rule on the same block', () => {
    expect(findSandwiches(bundleOf([...PAID]))).toEqual([])
  })

  it('drops a round trip that closed worse than it opened', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ATTACKER, ...OPENS),
      middle(2),
      leg(3, SECOND_WALLET, ...LOSES),
    ])

    expect(crossRoundTrips(bundle)).toEqual([])
  })

  it('leaves the same-signer pair to the rule that already covers it', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ATTACKER, ...OPENS),
      middle(2),
      leg(3, ATTACKER, ...CLOSES),
    ])

    expect(crossRoundTrips(bundle)).toEqual([])
  })

  /**
   * Not a filter but a definition: a pair with nobody in the middle has nobody to have
   * taken anything from. 400 of the 877 profitable cross-signer round trips in the cache
   * are adjacent legs like this, and every one of them would cost a reviewer two minutes
   * to answer what the block already says.
   */
  it('drops a pair with nobody between the legs', () => {
    const bundle = bundleOf([tx(0), leg(1, ATTACKER, ...OPENS), leg(2, SECOND_WALLET, ...CLOSES)])

    expect(crossRoundTrips(bundle)).toEqual([])
  })

  it('does not count either operator wallet as the party in the middle', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ATTACKER, ...OPENS),
      middle(2, -300n, SECOND_WALLET),
      leg(3, SECOND_WALLET, ...CLOSES),
    ])

    expect(crossRoundTrips(bundle)).toEqual([])
  })

  it('records which way the middle traded instead of filtering on it', () => {
    const [same] = crossRoundTrips(bundleOf([...PAID]))
    const [opposite] = crossRoundTrips(
      bundleOf([
        tx(0),
        leg(1, ATTACKER, ...OPENS),
        middle(2, 300n),
        leg(3, SECOND_WALLET, ...CLOSES),
      ]),
    )

    expect(same?.touched).toEqual([2])
    expect(same?.aligned).toEqual([2])
    expect(opposite?.touched).toEqual([2])
    expect(opposite?.aligned).toEqual([])
  })

  it('keeps a round trip that opened at one pool and closed at another', () => {
    const bundle = bundleOf([
      tx(0),
      leg(1, ATTACKER, ...OPENS),
      middle(2),
      leg(3, SECOND_WALLET, CLOSES[0], CLOSES[1], OTHER_POOL),
    ])
    const [hit] = crossRoundTrips(bundle)

    expect(hit?.openPool).toBe(POOL)
    expect(hit?.closePool).toBe(OTHER_POOL)
    expect(hit?.samePool).toBe(false)
  })

  it('will not reach across a window it was not given', () => {
    const bundle = bundleOf([
      leg(0, ATTACKER, ...OPENS),
      middle(1),
      middle(2),
      middle(3),
      middle(4),
      leg(5, SECOND_WALLET, ...CLOSES),
    ])

    expect(crossRoundTrips(bundle)).toEqual([])
    expect(crossRoundTrips(bundle, { window: 5 })).toHaveLength(1)
  })
})

const corpus = (overrides: Partial<Corpus> = {}): Corpus => ({
  signers: new Set([ATTACKER, SECOND_WALLET, VICTIM]),
  programSigners: new Map([
    [AMM, 4210],
    [BOT_PROGRAM, 2],
  ]),
  ...overrides,
})

describe('linksBetween — why two signers might be one operator', () => {
  it('names a program almost nobody else invokes', () => {
    const front = tx(1, { signers: [ATTACKER], programs: [AMM, BOT_PROGRAM] })
    const back = tx(3, { signers: [SECOND_WALLET], programs: [AMM, BOT_PROGRAM] })

    expect(linksBetween(front, back, corpus())).toEqual([{ kind: 'program', address: BOT_PROGRAM }])
  })

  it('says nothing about a program everybody invokes', () => {
    const front = tx(1, { signers: [ATTACKER], programs: [AMM] })
    const back = tx(3, { signers: [SECOND_WALLET], programs: [AMM] })

    expect(linksBetween(front, back, corpus())).toEqual([])
  })

  it('names a third party that moved value in both legs and signs somewhere', () => {
    const front = tx(1, {
      signers: [ATTACKER],
      tokenDelta: [{ owner: VICTIM, mint: QUOTE, amount: 5n }],
    })
    const back = tx(3, {
      signers: [SECOND_WALLET],
      tokenDelta: [{ owner: VICTIM, mint: QUOTE, amount: -5n }],
    })

    expect(linksBetween(front, back, corpus())).toEqual([{ kind: 'wallet', address: VICTIM }])
  })

  /**
   * The crude relation this replaces, pinned as a negative. Lamports leave an account
   * only with its signature or its owning program's authority, so a non-signer that
   * loses them is program-owned — a pool, a vault, a PDA. All 996 accounts the crude
   * rule named over the cache sign nothing anywhere in 1,071 slots.
   */
  it('does not take an account that pays both legs but never signs anything', () => {
    const front = tx(1, { signers: [ATTACKER], lamportDelta: { [TREASURY]: -7000n } })
    const back = tx(3, { signers: [SECOND_WALLET], lamportDelta: { [TREASURY]: -7000n } })

    expect(linksBetween(front, back, corpus())).toEqual([])
    expect(linksBetween(front, back, corpus({ signers: new Set([TREASURY]) }))).toEqual([
      { kind: 'wallet', address: TREASURY },
    ])
  })

  it('names the case where one leg’s signer moved value inside the other', () => {
    const front = tx(1, { signers: [ATTACKER] })
    const back = tx(3, {
      signers: [SECOND_WALLET],
      lamportDelta: { [ATTACKER]: 900n },
    })

    expect(linksBetween(front, back, corpus())).toEqual([{ kind: 'crossed', address: '' }])
  })

  it('ignores a balance that did not actually change', () => {
    const front = tx(1, { signers: [ATTACKER], lamportDelta: { [VICTIM]: 0n } })
    const back = tx(3, { signers: [SECOND_WALLET], lamportDelta: { [VICTIM]: 0n } })

    expect(linksBetween(front, back, corpus())).toEqual([])
  })
})
