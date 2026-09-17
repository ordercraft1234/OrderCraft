import type { NormalizedTransaction, SlotBundle } from '@ordercraft/core'

const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111'

export interface Candidate {
  slot: number
  /** Outer, middle, outer — positions in the recorded block. */
  positions: [number, number, number]
  /** The signer both outer transactions share. */
  signer: string
  /**
   * The signer of the closing leg, when it is a different party.
   *
   * Absent from everything `scan` writes — its whole filter is built on one signer
   * standing either side. It is written by `cross` (T058), whose pairs are signed by two
   * parties, and it travels in the same row shape so `review` and `label` need no second
   * path to read it.
   */
  counterSigner?: string
  /** Accounts the middle transaction touches that both outer ones touch too. */
  sharedAccounts: string[]
}

export interface ScanOptions {
  /** How far apart the outer transactions may sit. */
  window?: number
  /**
   * Keep triples in which one of the three transactions failed. Off by default —
   * see `findCandidates`. Exists so the claim that they are worthless stays
   * reproducible rather than becoming folklore.
   */
  includeFailed?: boolean
  /**
   * Keep triples whose outer pair moved no value to anybody. Off by default, for the
   * same reason as `includeFailed` and with the same purpose: the wide set stays
   * reachable, so the exclusion can be re-measured instead of believed.
   */
  includeInert?: boolean
}

/**
 * Selects triples for manual review. The rule is **deliberately wider than the
 * detector**: no direction of trade, no profitability, no adjacency — only "the same
 * party either side of someone else, on an account all three touch".
 *
 * That width is the point. If candidates were chosen by the detector's own rule, the
 * labelled set would contain exactly what the detector already finds, and measuring
 * its recall against that set would return 100% by construction.
 *
 * **Failed transactions are the one exclusion, and it does not narrow the filter
 * towards the detector.** Measured over the 171 cached slots: 9,796 candidates, of
 * which 80.9% touch a transaction that failed, and **not one** of the 38,733 failed
 * transactions in that cache carries a `tokenDelta`. A failed transaction records no
 * trade, so such a triple cannot be judged a sandwich by the detector, by the reviewer,
 * or under any other definition — there is no evidence in it either way. Dropping them
 * removes rows that are unlabellable in principle, not rows the detector would reject
 * on its own hypothesis, so recall is untouched.
 *
 * **A pair that moved no value is excluded on the same ground** — see `movedValue`.
 * Neither exclusion asks whether the triple looks like an attack; both ask whether
 * there is anything in it to look at.
 *
 * What the two buy together, measured over the cache: **57.3 candidates per slot become
 * 4.8**, which is the difference between roughly 9.6 hours and under an hour of review
 * for the five densely-labelled slots T047 needs. And they keep the false-positive half
 * of SC-003 honest — otherwise most of the denominator is refusals the detector makes
 * by construction, and the rate flatters itself.
 */
export function findCandidates(bundle: SlotBundle, options: ScanOptions = {}): Candidate[] {
  const window = options.window ?? 4
  const transactions = bundle.transactions.filter(
    (transaction) =>
      !transaction.programs.includes(VOTE_PROGRAM) &&
      (options.includeFailed === true || !transaction.failed),
  )

  // Every address this slot invokes anywhere, not merely the ones a given transaction
  // invokes itself. A program reached by CPI is absent from its caller's `programs` and
  // turns up in `accounts` looking exactly like a pool — the SPL token programs and the
  // memo program between them were the only thing 83% of candidates had in common.
  const invoked = new Set(bundle.transactions.flatMap((transaction) => transaction.programs))

  return transactions.flatMap((left, position) =>
    transactions
      .slice(position + 1)
      .filter((right) => right.index - left.index <= window)
      .flatMap((right) =>
        triplesFor(bundle.slot, transactions, left, right, {
          includeInert: options.includeInert === true,
          invoked,
        }),
      ),
  )
}

interface TripleContext {
  includeInert: boolean
  /** Addresses the slot invokes as programs anywhere. Sharing one is not a meeting. */
  invoked: Set<string>
}

/**
 * Whether a transaction handed value to anybody but its own signer.
 *
 * Native SOL never appears in `tokenDelta`, so an SPL check alone would throw away real
 * trades: of the 1,350 cached candidates whose pair moved no SPL token, **546 moved
 * lamports to a third party**. Those stay. What goes is the pair that moved nothing at
 * all — 804 of 1,617, just under half the shortlist — because a pair that neither
 * bought nor sold cannot have taken anything from the transaction between them, under
 * this product's own definition of extracted value.
 *
 * The signer's own entry is ignored: every fee payer is debited, and counting that as
 * movement would make the check pass for every transaction ever recorded.
 */
function movedValue(transaction: NormalizedTransaction): boolean {
  if (transaction.tokenDelta.length > 0) return true

  return Object.keys(transaction.lamportDelta).some(
    (account) => !transaction.signers.includes(account),
  )
}

function triplesFor(
  slot: number,
  transactions: NormalizedTransaction[],
  left: NormalizedTransaction,
  right: NormalizedTransaction,
  context: TripleContext,
): Candidate[] {
  const signer = sharedSigner(left, right)
  if (signer === undefined) return []
  if (!context.includeInert && !movedValue(left) && !movedValue(right)) return []

  const meeting = (transaction: NormalizedTransaction): string[] =>
    nonProgramAccounts(transaction, context.invoked)

  const outerAccounts = intersect(meeting(left), meeting(right))
  if (outerAccounts.length === 0) return []

  return between(transactions, left, right).flatMap((middle) => {
    const sharedAccounts = intersect(outerAccounts, meeting(middle))
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

/** The system program, which is an account on almost every transaction that pays a fee. */
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

/**
 * Accounts every transaction is entitled to name without it meaning anything: the
 * sysvars and the system program.
 *
 * They are not caught by the `programs` check, because a transaction *reads* the clock
 * rather than invoking it — so the address turns up in `accounts` and in nothing else.
 * Measured on the cache, 13.7% of surviving candidates had **no** common account except
 * these, which is the filter degenerating to "any two transactions by one signer".
 */
function isInfrastructure(account: string): boolean {
  return account.startsWith('Sysvar') || account === SYSTEM_PROGRAM
}

/**
 * Accounts minus everything two transactions can hold in common without it meaning
 * anything: any program the slot invokes, the transaction's own signers, and the
 * sysvars.
 *
 * Without this the filter degenerates to "any two transactions" — and it did. Before
 * `invoked` was widened from the transaction's own programs to the slot's, the three
 * commonest "shared accounts" in the whole shortlist were the two SPL token programs
 * and the memo program, reached by CPI and therefore invisible to a per-transaction
 * check.
 */
function nonProgramAccounts(transaction: NormalizedTransaction, invoked: Set<string>): string[] {
  return transaction.accounts.filter(
    (account) =>
      !invoked.has(account) && !transaction.signers.includes(account) && !isInfrastructure(account),
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
