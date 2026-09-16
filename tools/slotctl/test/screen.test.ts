import type { NormalizedTransaction, SlotBundle, WideHit } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import type { LegPair } from '../src/review.ts'
import { renderHit, screenSlot, summarize } from '../src/screen.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const OTHER_POOL = 'HxKPnR7BfVv2sLcQ4dTgWmYaJ6uEzN3XqAcSdFgHjKlM'
const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const WSOL = 'So11111111111111111111111111111111111111112'
const MINT = '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump'
const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const tx = (
  index: number,
  signer: string,
  tokenDelta: { owner: string; mint: string; amount: bigint }[] = [],
): NormalizedTransaction => ({
  index,
  signature: `sig${index}`.padEnd(44, 'x'),
  signers: [signer],
  programs: [AMM],
  accounts: [signer, POOL, AMM],
  fee: 5000n,
  failed: false,
  computeUnits: 1000n,
  lamportDelta: {},
  tokenDelta,
})

const leg = (index: number, wsol: bigint, token: bigint, pool = POOL) =>
  tx(index, ATTACKER, [
    { owner: ATTACKER, mint: WSOL, amount: wsol },
    { owner: pool, mint: WSOL, amount: -wsol },
    { owner: pool, mint: MINT, amount: token },
  ])

const middle = (index: number) =>
  tx(index, VICTIM, [
    { owner: VICTIM, mint: WSOL, amount: -300n },
    { owner: POOL, mint: WSOL, amount: 300n },
    { owner: VICTIM, mint: MINT, amount: 600n },
    { owner: POOL, mint: MINT, amount: -600n },
  ])

const bundle = (slot: number, transactions: NormalizedTransaction[]): SlotBundle => ({
  schemaVersion: 1,
  slot,
  blockTime: 0,
  transactions,
})

const pair = (slot: number, front: number, back: number, between: number[]): LegPair => ({
  slot,
  front,
  back,
  signer: ATTACKER,
  between: between.map((index) => ({ index, sharedAccounts: [POOL] })),
})

const profitable = bundle(445504723, [
  tx(0, VICTIM),
  leg(1, -1000n, -5000n),
  middle(2),
  leg(3, 1100n, 5000n, OTHER_POOL),
])

describe('screenSlot', () => {
  it('reports the survivors and the pairs a slot would cost to label', () => {
    const pairs = [pair(445504723, 1, 3, [2]), pair(445504723, 0, 2, [1])]

    const screened = screenSlot(profitable, pairs)

    expect(screened.slot).toBe(445504723)
    expect(screened.pairs).toBe(2)
    expect(screened.hits.map((hit) => `${hit.front}/${hit.back}`)).toEqual(['1/3'])
  })

  /**
   * The cost of choosing a slot is every pair `scan` proposes in it, not the survivors —
   * that is what `coverage: exhaustive` claims, and the claim is the only thing that
   * gives recall a denominator.
   */
  it('counts pairs of this slot alone, whatever else the shortlist holds', () => {
    const pairs = [pair(445504723, 1, 3, [2]), pair(445553238, 8, 10, [9])]

    expect(screenSlot(profitable, pairs).pairs).toBe(1)
  })

  it('finds nothing in a slot whose pairs are all elsewhere', () => {
    expect(screenSlot(profitable, [pair(445553238, 1, 3, [2])])).toEqual({
      slot: 445504723,
      pairs: 0,
      hits: [],
    })
  })
})

const hit = (overrides: Partial<WideHit> = {}): WideHit => ({
  front: 1,
  back: 3,
  signer: ATTACKER,
  between: [2],
  mint: WSOL,
  openPool: POOL,
  closePool: OTHER_POOL,
  samePool: false,
  touched: [2],
  aligned: [2],
  size: 1000n,
  ...overrides,
})

describe('renderHit', () => {
  it('says which way the party in between traded, without deciding anything by it', () => {
    expect(renderHit(hit())).toContain('#2 traded it, #2 the same way')
  })

  it('names the other direction as such rather than dropping the row', () => {
    expect(renderHit(hit({ aligned: [] }))).toContain('none the way the opening leg did')
  })

  it('says so when nobody in between touched the asset', () => {
    expect(renderHit(hit({ touched: [], aligned: [] }))).toContain('nobody in between traded it')
  })

  it('marks whether both legs met the same counterparty', () => {
    expect(renderHit(hit({ samePool: true }))).toContain('one pool')
    expect(renderHit(hit())).toContain('two pools')
  })
})

describe('summarize', () => {
  const screened = [
    { slot: 445504723, pairs: 2, hits: [hit()] },
    { slot: 445553238, pairs: 4, hits: [hit({ front: 394, back: 397 })] },
    { slot: 445829304, pairs: 7, hits: [] },
  ]

  it('separates what labelling would cost from what is already labelled', () => {
    const lines = summarize(screened, new Set([445553238])).split('\n')

    expect(lines[0]).toBe('3 slots scanned, 13 leg pairs')
    expect(lines[1]).toBe('2 profitable round trips in 2 slots, 6 pairs to label there')
    expect(lines[2]).toBe('1 of those slots are not labelled yet: 2 pairs, 445504723')
  })

  it('counts a slot once however many survivors it holds', () => {
    const twice = [{ slot: 445504723, pairs: 2, hits: [hit(), hit({ front: 5, back: 7 })] }]

    expect(summarize(twice, new Set()).split('\n')[1]).toBe(
      '2 profitable round trips in 1 slots, 2 pairs to label there',
    )
  })
})
