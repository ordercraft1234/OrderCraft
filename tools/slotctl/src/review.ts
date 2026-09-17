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
  /** The signer both legs share, or the opening leg's signer when they differ. */
  signer: string
  /**
   * The closing leg's signer, when the two legs were signed by different parties (T058).
   *
   * Absent for everything `scan` proposes. Where it is present the pair has **no** shared
   * signer at all, and the `net` block below prints a column per party rather than one —
   * a screen that headed two wallets' trades "the shared signer" would be contradicting
   * itself in the same breath it asked to be believed.
   */
  counterSigner?: string
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
      ...(candidate.counterSigner === undefined ? {} : { counterSigner: candidate.counterSigner }),
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
    pair.counterSigner === undefined
      ? `signer  ${pair.signer}`
      : `signers ${pair.signer} (front)
        ${pair.counterSigner} (back)`,
    `shared  ${shared.join(', ')}`,
    '',
    describe('leg  ', front),
    ...middles.map((transaction) => describe('mid  ', transaction)),
    describe('leg  ', back),
    '',
    ...netLines(front, back, middles, pair.signer, pair.counterSigner),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Native SOL as a mint, so it lines up with everything else that moved.
 *
 * It is not an SPL token and has no mint address, but a reviewer comparing the two
 * sides of a trade needs it in the same column as the token — on Solana one side of a
 * swap is very often native lamports, and a ledger showing only the other side is a
 * ledger with the price missing.
 */
const NATIVE = 'SOL (native)'

/** One transaction as a line: who, what it did, what moved. */
function describe(label: string, transaction: NormalizedTransaction): string {
  const head = `${label}#${String(transaction.index).padStart(4)}  ${short(
    transaction.signers[0] ?? '—',
  )}${transaction.failed ? '  FAILED' : ''}`

  // Lamports first: where a swap has a native side it is the side that carries the
  // price, and reading it after the token halves would put the answer below the fold.
  const moves = [
    ...Object.entries(transaction.lamportDelta).map(
      ([owner, amount]) => `        ${signed(amount)} ${NATIVE}  → ${short(owner)}`,
    ),
    ...transaction.tokenDelta.map(
      (delta) => `        ${signed(delta.amount)} ${short(delta.mint)}  → ${short(delta.owner)}`,
    ),
  ]

  if (moves.length === 0) return `${head}\n        (nothing moved)`
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
 * **Only the signer's own side counts.** `tokenDelta` records both ends of every
 * transfer, so summing a transaction whole always yields zero — netting the pair that
 * way printed a column of noughts for every candidate and said nothing about anybody's
 * position.
 *
 * **With two signers there are two positions**, printed one under the other. A pair from
 * `cross` (T058) has no shared party by construction: the round trip is split, one wallet
 * long what the other is short, and a single netted column would hide exactly the fact
 * the reviewer is being asked about.
 */
function netLines(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  middles: NormalizedTransaction[],
  signer: string,
  counterSigner?: string,
): string[] {
  const parties = counterSigner === undefined ? [signer] : [signer, counterSigner]
  const positions = parties.map((party) => ({ party, net: positionOf(front, back, party) }))

  if (positions.every(({ net }) => net.size === 0)) return ['net   (the pair holds no position)']

  const inMiddle = movedInBetween(middles)
  const rows = ({ party, net }: { party: string; net: Map<string, bigint> }): string[] => [
    // With two parties the mints have to be attributed, or a round trip split over two
    // wallets reads as one wallet holding both sides of it.
    ...(counterSigner === undefined ? [] : [`      ${short(party)}`]),
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

  return [
    counterSigner === undefined
      ? 'net   the shared signer across both legs, by mint'
      : 'net   each signer across both legs, by mint — the legs were signed by two parties',
    // The transaction fee is already inside the native figure: lamportDelta is post
    // minus pre, and the fee leaves the account before the post balance is recorded.
    // Saying so beats a reviewer discovering it as an unexplained few thousand.
    '      (the native figure is post minus pre, so the fee is already inside it)',
    ...positions.flatMap(rows),
  ]
}

/** One party's position across both legs, native SOL counted as a mint of its own. */
function positionOf(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  party: string,
): Map<string, bigint> {
  const net = new Map<string, bigint>()

  for (const transaction of [front, back]) {
    // Leaving the native side out was the difference between "this round trip lost
    // money" and "+736,315,196 lamports": on a swap that settles in SOL, the token
    // column alone shows the size and never the proceeds.
    const lamports = transaction.lamportDelta[party]
    if (lamports !== undefined) net.set(NATIVE, (net.get(NATIVE) ?? 0n) + lamports)

    for (const delta of transaction.tokenDelta) {
      if (delta.owner !== party) continue
      net.set(delta.mint, (net.get(delta.mint) ?? 0n) + delta.amount)
    }
  }

  return net
}

/**
 * Which transactions between the legs touched which mint, native SOL included.
 *
 * This is what turns the `net` block from a statement about the pair into a question
 * about the trade: a mint the pair reversed and nobody in between touched is a round
 * trip against the pool, not against a person.
 */
function movedInBetween(middles: NormalizedTransaction[]): Map<string, number[]> {
  const inMiddle = new Map<string, number[]>()

  for (const transaction of middles) {
    const mints = [
      ...(Object.keys(transaction.lamportDelta).length > 0 ? [NATIVE] : []),
      ...transaction.tokenDelta.map((delta) => delta.mint),
    ]

    for (const mint of mints) {
      const seen = inMiddle.get(mint) ?? []
      if (!seen.includes(transaction.index)) inMiddle.set(mint, [...seen, transaction.index])
    }
  }

  return inMiddle
}

function signed(amount: bigint): string {
  return `${amount > 0n ? '+' : ''}${amount.toString()}`.padStart(22)
}

/** Enough of an address to tell two apart on one screen, and to search the slot for. */
function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}
