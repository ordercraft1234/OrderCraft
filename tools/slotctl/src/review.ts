import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'
import type { Candidate } from './scan.ts'

/**
 * Renders one candidate as the facts a person needs to answer "is this a sandwich?".
 *
 * **It never runs the detector, and that is the point.** T047 exists to produce labels
 * the detector is then measured against; a screen that showed the detector's opinion
 * would produce labels that agree with it, and SC-003 would be measuring the reviewer's
 * deference rather than the rule. So this prints evidence only — who signed what, which
 * mints moved and by how much, what the three transactions have in common — and leaves
 * the judgement where it belongs.
 *
 * The layout is built around the one question that decides most rows: did the outer
 * pair take **opposite sides of the same mint**, and did the transaction between them
 * move that mint too? Those numbers sit together under `net`, so the answer is a glance
 * rather than three lookups.
 */
export function renderCandidate(bundle: SlotBundle, candidate: Candidate): string {
  const [leftIndex, middleIndex, rightIndex] = candidate.positions
  const at = (index: number): NormalizedTransaction | undefined =>
    bundle.transactions.find((transaction) => transaction.index === index)

  const left = at(leftIndex)
  const middle = at(middleIndex)
  const right = at(rightIndex)
  if (left === undefined || middle === undefined || right === undefined) {
    return `slot ${candidate.slot}  positions ${candidate.positions.join(', ')}\n  ! the slot does not hold all three transactions\n`
  }

  const lines = [
    `slot ${candidate.slot}   positions ${leftIndex}, ${middleIndex}, ${rightIndex}   span ${
      rightIndex - leftIndex
    }`,
    `signer  ${candidate.signer}`,
    `shared  ${candidate.sharedAccounts.join(', ')}`,
    '',
    describe('leg  ', left),
    describe('mid  ', middle),
    describe('leg  ', right),
    '',
    ...netLines(left, middle, right, candidate.signer),
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
 * The outer pair's net position per mint, and whether the middle transaction touched
 * the same mint.
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
  left: NormalizedTransaction,
  middle: NormalizedTransaction,
  right: NormalizedTransaction,
  signer: string,
): string[] {
  const net = new Map<string, bigint>()
  for (const transaction of [left, right]) {
    for (const delta of transaction.tokenDelta) {
      if (delta.owner !== signer) continue
      net.set(delta.mint, (net.get(delta.mint) ?? 0n) + delta.amount)
    }
  }

  if (net.size === 0) return ['net   (the pair holds no token position)']

  const middleMints = new Set(middle.tokenDelta.map((delta) => delta.mint))
  return [
    'net   the shared signer across both legs, by mint',
    ...[...net.entries()]
      .sort(([leftMint], [rightMint]) => (leftMint < rightMint ? -1 : 1))
      .map(
        ([mint, amount]) =>
          `        ${signed(amount)} ${short(mint)}${
            middleMints.has(mint) ? '   ← the middle moved this mint too' : ''
          }`,
      ),
  ]
}

function signed(amount: bigint): string {
  return `${amount > 0n ? '+' : ''}${amount.toString()}`.padStart(22)
}

/** Enough of an address to tell two apart on one screen, and to search the slot for. */
function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}
