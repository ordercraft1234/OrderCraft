import type { NormalizedTransaction, ShapeHit, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import type { LegPair } from '../src/review.ts'
import { renderHit, shapeSlot, summarize } from '../src/shape.ts'

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

const middle = (index: number, pool = POOL) =>
  tx(index, VICTIM, [
    { owner: VICTIM, mint: WSOL, amount: -300n },
    { owner: pool, mint: WSOL, amount: 300n },
    { owner: VICTIM, mint: MINT, amount: 600n },
    { owner: pool, mint: MINT, amount: -600n },
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

/** Opens at 1,000 wSOL and closes at 900 — the shape, and a loss. */
const LOST = bundle(445553238, [
  tx(0, VICTIM),
  leg(1, -1000n, -5000n),
  middle(2),
  leg(3, 900n, 5000n),
])
const PAIRS = [pair(445553238, 1, 3, [2])]

describe('shapeSlot — slots holding the shape, paid or not', () => {
  it('keeps the pair that lost money and says so', () => {
    const shaped = shapeSlot(LOST, PAIRS)

    expect(shaped.hits).toHaveLength(1)
    expect(shaped.hits[0]?.paid).toBe(false)
    expect(shaped.pairs).toBe(1)
  })

  it('counts only the pairs of its own slot as the labelling cost', () => {
    const shaped = shapeSlot(LOST, [...PAIRS, pair(445660284, 1, 3, [2])])

    expect(shaped.pairs).toBe(1)
  })

  it('finds nothing where the legs met two different pools', () => {
    const crossPool = bundle(445553238, [
      tx(0, VICTIM),
      leg(1, -1000n, -5000n),
      middle(2),
      leg(3, 900n, 5000n, OTHER_POOL),
    ])

    expect(shapeSlot(crossPool, PAIRS).hits).toEqual([])
  })
})

describe('renderHit and summarize — what the run tells the person reading it', () => {
  it('prints the three checks as facts rather than applying them', () => {
    const line = renderHit(shapeSlot(LOST, PAIRS).hits[0] as ShapeHit)

    expect(line).toContain('#2 traded it there')
    expect(line).toContain('and it did NOT pay')
    expect(line).toContain('closed 90% of the opening leg')
  })

  /**
   * The number the labelling budget is read off, and the one that says whether a bigger
   * cache bought anything: slots holding the shape that nobody has judged yet.
   */
  it('separates the slots already labelled from the ones a person still owes', () => {
    const shaped = [shapeSlot(LOST, PAIRS), shapeSlot(bundle(445660284, LOST.transactions), PAIRS)]
    const report = summarize(shaped, new Set([445553238]))

    expect(report).toContain('1 pairs have the shape, in 1 slots')
    expect(report).toContain('0 that paid')
    expect(report).toContain('0 of those slots are not labelled yet')
  })
})
