import type { Corpus, NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { corpusOf, crossSlot, renderHit, summarize, toCandidates } from '../src/cross.ts'
import { groupByLegs, renderPair } from '../src/review.ts'

const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
const OTHER_POOL = 'HxKPnR7BfVv2sLcQ4dTgWmYaJ6uEzN3XqAcSdFgHjKlM'
const FIRST = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const SECOND = 'BvEQ8sT2ZmXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh'
const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
const WSOL = 'So11111111111111111111111111111111111111112'
const MINT = '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump'
const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const BOT = 'Bot1cV6xWq2sLcQ4dTgWmYaJ6uEzN3XqAcSdFgHjKlM'

const tx = (
  index: number,
  signer: string,
  tokenDelta: { owner: string; mint: string; amount: bigint }[] = [],
  programs: string[] = [AMM],
): NormalizedTransaction => ({
  index,
  signature: `sig${index}`.padEnd(44, 'x'),
  signers: [signer],
  programs,
  accounts: [signer, POOL, AMM],
  fee: 5000n,
  failed: false,
  computeUnits: 1000n,
  lamportDelta: {},
  tokenDelta,
})

/** A leg priced at its pool: the signer's wSOL against the token the pool moves back. */
const leg = (
  index: number,
  signer: string,
  wsol: bigint,
  token: bigint,
  pool = POOL,
  programs: string[] = [AMM, BOT],
): NormalizedTransaction =>
  tx(
    index,
    signer,
    [
      { owner: signer, mint: WSOL, amount: wsol },
      { owner: pool, mint: WSOL, amount: -wsol },
      { owner: pool, mint: MINT, amount: token },
    ],
    programs,
  )

const middle = (index: number): NormalizedTransaction =>
  tx(index, VICTIM, [
    { owner: VICTIM, mint: WSOL, amount: -300n },
    { owner: POOL, mint: WSOL, amount: 300n },
    { owner: VICTIM, mint: MINT, amount: 600n },
    { owner: POOL, mint: MINT, amount: -600n },
  ])

const bundleOf = (slot: number, transactions: NormalizedTransaction[]): SlotBundle => ({
  schemaVersion: 1,
  slot,
  blockTime: 0,
  transactions,
})

/** One wallet opens at 1,000 wSOL, the other closes at 1,100 — a profitable round trip. */
const SLOT = bundleOf(445565758, [
  tx(0, VICTIM),
  leg(1, FIRST, -1000n, -5000n),
  middle(2),
  leg(3, SECOND, 1100n, 5000n, OTHER_POOL),
])

/**
 * Enough other traders to make the AMM ordinary. Without them a three-transaction corpus
 * has every program looking bespoke, which is the corpus being too small rather than the
 * programs being rare — and it would link every pair in the set.
 */
const CROWD = ['C', 'D', 'E', 'F', 'G'].map((mark, at) =>
  bundleOf(500 + at, [tx(0, `${mark}rowdrXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey`, [], [AMM])]),
)

const CORPUS = corpusOf([SLOT, ...CROWD])

describe('corpusOf — what a body of slots knows about accounts and programs', () => {
  it('counts the distinct signers behind each program', () => {
    expect(CORPUS.programSigners.get(BOT)).toBe(2)
    expect(CORPUS.programSigners.get(AMM)).toBe(8)
    expect(CORPUS.signers.has(FIRST)).toBe(true)
  })

  it('does not count a failed transaction — it invoked nothing that settled', () => {
    const failed = { ...tx(4, 'FaiLedSignerXo94BpPDA5Q18TCXSvtwxGnXp47GVr7M'), failed: true }
    const corpus = corpusOf([bundleOf(1, [...SLOT.transactions, failed])])

    expect(corpus.signers.has('FaiLedSignerXo94BpPDA5Q18TCXSvtwxGnXp47GVr7M')).toBe(false)
  })
})

describe('crossSlot — the round trips of one slot with what relates their signers', () => {
  it('finds the pair and names the program only these two wallets invoke', () => {
    const { hits } = crossSlot(SLOT, CORPUS)

    expect(hits).toHaveLength(1)
    expect(hits[0]?.trip.front).toBe(1)
    expect(hits[0]?.trip.back).toBe(3)
    expect(hits[0]?.links).toEqual([{ kind: 'program', address: BOT }])
  })

  /**
   * The property the whole design rests on: the link is a fact about the corpus, the
   * pair is a fact about the block. Widen the corpus until the program is ordinary and
   * the same pair is still proposed for labelling — otherwise the labelled set would
   * change shape every time a slot was added to the repository.
   */
  it('keeps proposing the pair when the corpus makes the link ordinary', () => {
    const busy = ['H', 'I', 'J', 'K'].map((mark, at) =>
      bundleOf(600 + at, [tx(0, `${mark}usierXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey`, [], [BOT])]),
    )
    const { hits } = crossSlot(SLOT, corpusOf([SLOT, ...CROWD, ...busy]))

    expect(hits).toHaveLength(1)
    expect(hits[0]?.links).toEqual([])
  })
})

describe('toCandidates — the pairs as rows review and label already understand', () => {
  it('emits one row per transaction between the legs, carrying both signers', () => {
    const rows = toCandidates([crossSlot(SLOT, CORPUS)])

    expect(rows).toEqual([
      {
        slot: 445565758,
        positions: [1, 2, 3],
        signer: FIRST,
        counterSigner: SECOND,
        sharedAccounts: [WSOL],
      },
    ])
  })

  /**
   * The screen that renders these pairs was written for one signer standing either side.
   * Told about two, it has to print two positions — a heading that said "the shared
   * signer" over a pair that has none would be contradicting itself in the same breath
   * it asked to be believed, which is exactly the defect T029 found on the attack screen.
   */
  it('renders a pair with two signers as two positions, not one', () => {
    const [pair] = groupByLegs(toCandidates([crossSlot(SLOT, CORPUS)]))
    const screen = renderPair(SLOT, pair as never)

    expect(screen).toContain('(front)')
    expect(screen).toContain('(back)')
    expect(screen).toContain('the legs were signed by two parties')
    expect(screen).not.toContain('the shared signer across both legs')
  })
})

describe('renderHit and summarize — what the run tells the person reading it', () => {
  it('says what related the signers, and says so when nothing did', () => {
    const { hits } = crossSlot(SLOT, CORPUS)
    // A corpus that has seen nothing links nothing: unknown is not the same as rare.
    const unlinked = crossSlot(SLOT, { signers: new Set(), programSigners: new Map() } as Corpus)

    expect(renderHit(hits[0] as never)).toContain(`program ${BOT}`)
    expect(renderHit(unlinked.hits[0] as never)).toContain('no visible link')
  })

  it('counts the linked slots and the control slots apart', () => {
    const linked = crossSlot(SLOT, CORPUS)
    const control = crossSlot(bundleOf(445577339, SLOT.transactions), {
      signers: new Set(),
      programSigners: new Map(),
    } as Corpus)
    const report = summarize([linked, control])

    expect(report).toContain('2 profitable cross-signer round trips in 2 slots')
    expect(report).toContain('1 slots hold a pair whose signers are visibly linked')
    expect(report).toContain('1 slots hold an unlinked pair')
  })
})
