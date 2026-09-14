import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import type { Candidate } from './scan.ts'

/**
 * One pair of legs with everything `scan` found between them.
 *
 * **This is the unit of review, and it is not the unit `scan` emits.** A shortlist row
 * names one transaction between the legs, so a pair with three transactions between it
 * arrives as three rows describing the same trade from the same signer. A label,
 * meanwhile, is written per pair — `attacks` and `rejected` in `packages/fixtures/labels`
 * carry `front`, `victims[]`, `back`, and `accuracyAgainst` matches triples on the legs
 * alone. Reviewing row by row would ask the same question up to three times and then
 * record one answer.
 *
 * Measured over the 1,071-slot cache on 2026-09-10: 4,843 rows are 3,759 pairs, and in
 * the seven slots T047 labels, 82 rows are 56 pairs — about 50 minutes of the owner's
 * time that no longer buys anything.
 */
export interface LegPair {
  slot: number
  front: number
  back: number
  /** The signer both legs share. */
  signer: string
  /** Everything the shortlist found between the legs, in block order. */
  between: { index: number; sharedAccounts: string[] }[]
}

/**
 * Groups shortlist rows into the pairs a label is written about, keeping the order the
 * rows arrived in so an interrupted review resumes at the same index.
 */
export function groupByLegs(candidates: Candidate[]): LegPair[] {
  const pairs = new Map<string, LegPair>()

  for (const candidate of candidates) {
    const [front, middle, back] = candidate.positions
    const key = `${candidate.slot}-${front}-${back}`
    const pair = pairs.get(key) ?? {
      slot: candidate.slot,
      front,
      back,
      signer: candidate.signer,
      between: [],
    }

    // A row repeated for the same transaction would double it on screen; the shortlist
    // is generated, and generated input is the kind that repeats itself.
    if (!pair.between.some((entry) => entry.index === middle)) {
      pair.between.push({ index: middle, sharedAccounts: candidate.sharedAccounts })
    }
    pairs.set(key, pair)
  }

  for (const pair of pairs.values()) pair.between.sort((left, right) => left.index - right.index)

  return [...pairs.values()]
}

/**
 * Renders one pair as the facts a person needs to answer "is this a sandwich?".
 *
 * **It never runs the detector, and that is the point.** T047 exists to produce labels
 * the detector is then measured against; a screen that showed the detector's opinion
 * would produce labels that agree with it, and SC-003 would be measuring the reviewer's
 * deference rather than the rule. So this prints evidence only — who signed what, which
 * mints moved and by how much, what the transactions have in common — and leaves the
 * judgement where it belongs.
 *
 * The layout is built around the one question that decides most rows: did the outer
 * pair take **opposite sides of the same mint**, and did anything between them move
 * that mint too? Those numbers sit together under `net`, so the answer is a glance
 * rather than three lookups.
 */
export function renderPair(bundle: SlotBundle, pair: LegPair): string {
  const at = (index: number): NormalizedTransaction | undefined =>
    bundle.transactions.find((transaction) => transaction.index === index)

  const front = at(pair.front)
  const back = at(pair.back)
  const between = pair.between.map((entry) => ({ entry, transaction: at(entry.index) }))
  const positions = [pair.front, ...pair.between.map((entry) => entry.index), pair.back]

  if (
    front === undefined ||
    back === undefined ||
    between.some(({ transaction }) => !transaction)
  ) {
    return `slot ${pair.slot}  positions ${positions.join(', ')}\n  ! the slot does not hold all three transactions\n`
  }

  const shared = [...new Set(pair.between.flatMap((entry) => entry.sharedAccounts))]
  const middles = between.flatMap(({ transaction }) => (transaction ? [transaction] : []))
  const lines = [
    `slot ${pair.slot}   positions ${positions.join(', ')}   span ${pair.back - pair.front}`,
    `signer  ${pair.signer}`,
    `shared  ${shared.join(', ')}`,
    '',
    describe('leg  ', front),
    ...middles.map((transaction) => describe('mid  ', transaction)),
    describe('leg  ', back),
    '',
    ...netLines(front, back, middles, pair.signer),
  ]

  return `${lines.join('\n')}\n`
}

/** One transaction as a line: who, what it did, what moved. */
function describe(label: string, transaction: NormalizedTransaction): string {
  const head = `${label}#${String(transaction.index).padStart(4)}  ${short(
    transaction.signers[0] ?? '—',
  )}${transaction.failed ? '  FAILED' : ''}`

  if (transaction.tokenDelta.length === 0) return `${head}\n        (no token movement)`

  const moves = transaction.tokenDelta.map(
    (delta) => `        ${signed(delta.amount)} ${short(delta.mint)}  → ${short(delta.owner)}`,
  )
  return [head, ...moves].join('\n')
}

/**
 * The outer pair's net position per mint, and whether anything between them touched the
 * same mint.
 *
 * A round trip shows up here as one mint the pair is long and another it is short. An
 * arbitrage between two pools looks the same on this line, which is exactly why the
 * reviewer still has to look at `shared` — the numbers narrow the question, they do not
 * answer it.
 *
 * **Only the shared signer's own side counts.** `tokenDelta` records both ends of every
 * transfer, so summing a transaction whole always yields zero — netting the pair that
 * way printed a column of noughts for every candidate and said nothing about anybody's
 * position.
 */
function netLines(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  middles: NormalizedTransaction[],
  signer: string,
): string[] {
  const net = new Map<string, bigint>()
  for (const transaction of [front, back]) {
    for (const delta of transaction.tokenDelta) {
      if (delta.owner !== signer) continue
      net.set(delta.mint, (net.get(delta.mint) ?? 0n) + delta.amount)
    }
  }

  if (net.size === 0) return ['net   (the pair holds no token position)']

  const inMiddle = new Map<string, number[]>()
  for (const transaction of middles) {
    for (const delta of transaction.tokenDelta) {
      const seen = inMiddle.get(delta.mint) ?? []
      if (!seen.includes(transaction.index)) inMiddle.set(delta.mint, [...seen, transaction.index])
    }
  }

  return [
    'net   the shared signer across both legs, by mint',
    ...[...net.entries()]
      .sort(([leftMint], [rightMint]) => (leftMint < rightMint ? -1 : 1))
      .map(([mint, amount]) => {
        // Which of the transactions in between moved this mint, by position — with
        // several of them the reviewer needs to know which one was traded against, and
        // that is the transaction a label records.
        const movers = inMiddle.get(mint)
        const mark =
          movers === undefined
            ? ''
            : `   ← also moved by #${movers.map((index) => String(index)).join(', #')}`

        return `        ${signed(amount)} ${short(mint)}${mark}`
      }),
  ]
}

function signed(amount: bigint): string {
  return `${amount > 0n ? '+' : ''}${amount.toString()}`.padStart(22)
}

/** Enough of an address to tell two apart on one screen, and to search the slot for. */
function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}
