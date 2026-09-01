import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'

const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111'

export interface Candidate {
  slot: number
  /** Outer, middle, outer — positions in the recorded block. */
  positions: [number, number, number]
  /** The signer both outer transactions share. */
  signer: string
  /** Accounts the middle transaction touches that both outer ones touch too. */
  sharedAccounts: string[]
}

export interface ScanOptions {
  /** How far apart the outer transactions may sit. */
  window?: number
}

/**
 * Selects triples for manual review. The rule is **deliberately wider than the
 * detector**: no direction of trade, no profitability, no adjacency — only "the same
 * party either side of someone else, on an account all three touch".
 *
 * That width is the point. If candidates were chosen by the detector's own rule, the
 * labelled set would contain exactly what the detector already finds, and measuring
 * its recall against that set would return 100% by construction.
 */
export function findCandidates(bundle: SlotBundle, options: ScanOptions = {}): Candidate[] {
  const window = options.window ?? 4
  const transactions = bundle.transactions.filter(
    (transaction) => !transaction.programs.includes(VOTE_PROGRAM),
  )

  return transactions.flatMap((left, position) =>
    transactions
      .slice(position + 1)
      .filter((right) => right.index - left.index <= window)
      .flatMap((right) => triplesFor(bundle.slot, transactions, left, right)),
  )
}

function triplesFor(
  slot: number,
  transactions: NormalizedTransaction[],
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): Candidate[] {
  const signer = sharedSigner(left, right)
  if (signer === undefined) return []

  const outerAccounts = intersect(nonProgramAccounts(left), nonProgramAccounts(right))
  if (outerAccounts.length === 0) return []

  return between(transactions, left, right).flatMap((middle) => {
    const sharedAccounts = intersect(outerAccounts, nonProgramAccounts(middle))
    return sharedAccounts.length === 0
      ? []
      : [
          {
            slot,
            positions: [left.index, middle.index, right.index] as [number, number, number],
            signer,
            sharedAccounts,
          },
        ]
  })
}

/** Transactions strictly between the pair, signed by somebody else. */
function between(
  transactions: NormalizedTransaction[],
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): NormalizedTransaction[] {
  return transactions.filter(
    (middle) =>
      middle.index > left.index &&
      middle.index < right.index &&
      sharedSigner(middle, left) === undefined &&
      sharedSigner(middle, right) === undefined,
  )
}

function sharedSigner(
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): string | undefined {
  return left.signers.find((signer) => right.signers.includes(signer))
}

/**
 * Accounts minus the programs the transaction invokes and minus its own signers.
 * Without this every pair of transactions "shares" the token program and the
 * compute-budget program, and the filter degenerates to "any two transactions".
 */
function nonProgramAccounts(transaction: NormalizedTransaction): string[] {
  return transaction.accounts.filter(
    (account) => !transaction.programs.includes(account) && !transaction.signers.includes(account),
  )
}

function intersect(left: string[], right: string[]): string[] {
  const other = new Set(right)
  return [...new Set(left.filter((value) => other.has(value)))]
}

/**
 * Draws `count` slots deterministically. The curated set has to be reproducible from
 * the seed alone: a slot somebody spent two minutes labelling must still be in the
 * sample after a re-scan, otherwise the labels drift away from the set they describe.
 *
 * The pool is sorted first. `readdirSync` order is filesystem-dependent, and a seed
 * that only reproduces on the machine that drew it reproduces nothing.
 */
export function sampleSlots(slots: number[], count: number, seed: number): number[] {
  const pool = [...new Set(slots)].sort(ascending)
  const take = Math.min(Math.max(count, 0), pool.length)
  const random = mulberry32(seed)

  return pool
    .map((slot) => ({ slot, key: random() }))
    .sort((left, right) => left.key - right.key)
    .slice(0, take)
    .map(({ slot }) => slot)
    .sort(ascending)
}

function ascending(left: number, right: number): number {
  return left - right
}

/** mulberry32 — 32 bits of state, enough for a shortlist and short enough to read. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}
