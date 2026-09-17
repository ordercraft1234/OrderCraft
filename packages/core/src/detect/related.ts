import type { NormalizedTransaction, SlotBundle } from '../slot/schema.ts'
import { absolute, improved, largestCounterparty, netOf, ownNet, poolSide } from './price.ts'

/** How far apart the legs may sit before this stops being one bundle — as everywhere else. */
const DEFAULT_WINDOW = 4

/**
 * Consensus votes, which are most of a block and none of a trade.
 *
 * They are dropped here and not in `findSandwiches` because this function decides what a
 * person is asked to judge: a vote between two legs is somebody in the middle who moved
 * no value and cannot have been traded against. `slotctl scan` drops them for the same
 * reason, and the two universes have to agree about what "between the legs" means or the
 * two label sets are counting different things.
 */
const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111'

/**
 * How many distinct signers may invoke a program across the corpus before sharing it
 * stops meaning anything.
 *
 * Measured over the 1,071-slot cache on 2026-09-10: 967 programs, half of them invoked
 * by two signers or fewer, the widest by 90,722. A program two wallets use and nobody
 * else is evidence they are run by one operator; the token program is evidence of
 * nothing. **The figure is not load-bearing** — the pairs that survive the whole screen
 * are the same three for every threshold from 2 to 50, which is the measurement that
 * matters and is why no effort went into tuning it further.
 */
const DEFAULT_MAX_PROGRAM_SIGNERS = 3

/**
 * A pair of legs signed by **different** parties, with somebody else between them.
 *
 * Everything else in this repository — `slotctl scan`, `findSandwiches`, the wider screen
 * of T057 — requires one signer on both legs. That is the last assumption nobody had
 * tested (T058): a bot running two wallets is invisible to the filter, to the screen, to
 * the detector and therefore to every label written so far.
 */
export interface CrossPair {
  front: number
  back: number
  /** The party that signed the opening leg. */
  frontSigner: string
  /** And the closing one — a different party, which is the whole point. */
  backSigner: string
  /**
   * Positions between the legs signed by somebody who is neither, in block order.
   *
   * **Never empty, and that is a definition rather than a filter.** A sandwich needs
   * somebody in the middle to have been sandwiched; a pair of adjacent legs has nobody
   * to have taken anything from, and asking a person to judge it spends two minutes to
   * learn what the block already said. Of the 877 profitable cross-signer round trips in
   * the cache, 400 have nothing between the legs at all.
   */
  between: number[]
}

export interface CrossRoundTrip extends CrossPair {
  /** The asset whose direction reverses between the legs. */
  mint: string
  /** The counterparty that took the other side of the opening leg. */
  openPool: string
  /** And of the closing one — not required to be the same party. */
  closePool: string
  samePool: boolean
  /** Positions between the legs that traded the mint at all. */
  touched: number[]
  /** Of those, the ones that traded it the way the opening leg did. */
  aligned: number[]
  /** How much of the mint the opening leg moved, unsigned. */
  size: bigint
}

export type LinkKind = 'wallet' | 'program' | 'crossed'

/** One reason to think the two signers are the same operator. */
export interface Link {
  kind: LinkKind
  /** The account or program that carries the link; empty for `crossed`. */
  address: string
}

/**
 * What the surrounding corpus knows about accounts and programs.
 *
 * Passed in rather than derived here because both facts are properties of a body of
 * blocks, not of one slot: a program looks rare in any block read on its own. The caller
 * says which corpus it measured, and `slotctl cross` prints it.
 */
export interface Corpus {
  /** Every account that signs anything anywhere in the corpus. */
  signers: ReadonlySet<string>
  /** How many distinct signers invoke each program across the corpus. */
  programSigners: ReadonlyMap<string, number>
  maxProgramSigners?: number
}

/**
 * Profitable round trips whose two legs were signed by different parties (T058).
 *
 * The questions are the ones the wider screen of T057 asks — reversed mint, price
 * readable on both legs, closed better than it opened — with "the same signer" replaced
 * by "somebody else between two different signers". Nothing here asks whether the two
 * signers are related: that is `linksBetween`, it is a property of the corpus rather
 * than of the block, and keeping it out means the set a person labels can be rebuilt
 * from the repository alone.
 *
 * **What the funnel looks like.** Over the 1,071-slot cache on 2026-09-10: 1,098,597
 * pairs of legs with different signers inside a window of four, of which 4,639 reverse a
 * mint, 3,784 carry a readable price on both legs, **877 closed better than they opened**,
 * and **477 of those have somebody between the legs** — 186 of them somebody trading the
 * same asset. This function returns those 477.
 *
 * **What it cannot answer.** Two wallets of one operator need share nothing an observer
 * can see: separate keypairs, a public router, funding arranged long before the cache
 * begins. 863 of the 877 carry no visible link at all, and no rule reads intent off a
 * block. The honest statement is therefore about the visible subset, and it must travel
 * with any number read off this set.
 */
export function crossRoundTrips(
  bundle: SlotBundle,
  options: { window?: number } = {},
): CrossRoundTrip[] {
  const window = options.window ?? DEFAULT_WINDOW
  // A failed transaction moved no balance, so it can neither trade nor be traded
  // against — the same exclusion `findSandwiches` and `scan` make, for the same reason.
  const live = bundle.transactions.filter(
    (transaction) => !transaction.failed && !transaction.programs.includes(VOTE_PROGRAM),
  )

  return live.flatMap((front, position) =>
    live
      .slice(position + 1)
      .filter((back) => back.index - front.index <= window && !sharesSigner(front, back))
      .flatMap((back) => tripFor(live, front, back)),
  )
}

/** One pair as a round trip, or nothing when the block does not answer for it. */
function tripFor(
  live: NormalizedTransaction[],
  front: NormalizedTransaction,
  back: NormalizedTransaction,
): CrossRoundTrip[] {
  const between = live.filter(
    (middle) =>
      middle.index > front.index &&
      middle.index < back.index &&
      !sharesSigner(middle, front) &&
      !sharesSigner(middle, back),
  )
  if (between.length === 0) return []

  const round = bestRound(front, back)

  return round === null ? [] : [describe(front, back, between, round)]
}

/**
 * Why these two signers might be one operator, read off the block and the corpus.
 *
 * Three readings, and each is here because the crude one it replaces cannot work.
 * **The crude reading was "some account with a negative native balance paid both legs".**
 * It names a pool every time: moving lamports out of an account requires either its
 * signature or its owning program, so a non-signer that loses lamports *is* a
 * program-owned account by construction. Measured on the cache, all **996** accounts the
 * crude rule proposed as payers sign nothing anywhere in 1,071 slots, and one of them
 * stands in 7 of the 14 pairs it produced. It is not a weak proxy for an operator; it
 * cannot express one.
 *
 * - **`wallet`** — a third party that moved value in both legs and signs somewhere in the
 *   corpus, so it holds a keypair rather than a program's authority.
 * - **`program`** — a program invoked by both legs and by almost nobody else. Two wallets
 *   driving the same bespoke program is the strongest signal a block carries.
 * - **`crossed`** — one leg's signer moved value inside the other leg. The two wallets met.
 *
 * Applied to the 877 profitable round trips: `wallet` 0, `program` 13, `crossed` 1.
 */
export function linksBetween(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  corpus: Corpus,
): Link[] {
  const maxSigners = corpus.maxProgramSigners ?? DEFAULT_MAX_PROGRAM_SIGNERS
  const own = (account: string): boolean =>
    front.signers.includes(account) || back.signers.includes(account)
  const frontMoved = moved(front)
  const backMoved = moved(back)

  const wallets = [...frontMoved]
    .filter((account) => backMoved.has(account) && !own(account) && corpus.signers.has(account))
    .sort(byAddress)
  const programs = front.programs
    .filter((program) => back.programs.includes(program) && isRare(program, corpus, maxSigners))
    .sort(byAddress)
  const crossed =
    front.signers.some((signer) => backMoved.has(signer)) ||
    back.signers.some((signer) => frontMoved.has(signer))

  return [
    ...wallets.map((address): Link => ({ kind: 'wallet', address })),
    ...programs.map((address): Link => ({ kind: 'program', address })),
    ...(crossed ? [{ kind: 'crossed', address: '' } as Link] : []),
  ]
}

/**
 * Whether a program is invoked by few enough signers to mean something.
 *
 * A program the corpus has never seen is **not** rare — it is unmeasured, and the two
 * are opposite claims. Read as rare, an unknown program would turn every corpus that
 * happens not to cover a slot into one that links all of its pairs.
 */
function isRare(program: string, corpus: Corpus, maxSigners: number): boolean {
  const invoking = corpus.programSigners.get(program)

  return invoking !== undefined && invoking <= maxSigners
}

/** Accounts whose balance this transaction actually changed, native side included. */
function moved(transaction: NormalizedTransaction): Set<string> {
  const accounts = new Set<string>()
  for (const [account, amount] of Object.entries(transaction.lamportDelta)) {
    if (amount !== 0n) accounts.add(account)
  }
  for (const delta of transaction.tokenDelta) {
    if (delta.amount !== 0n) accounts.add(delta.owner)
  }

  return accounts
}

interface Round {
  mint: string
  openPool: string
  closePool: string
  opened: bigint
}

/**
 * The largest mint the pair reversed and closed at a better price than it opened.
 *
 * Direction is read on each leg's **own** signers: with two parties there is no shared
 * wallet to net across, and a round trip split over two wallets shows up as one of them
 * short what the other is long.
 */
function bestRound(front: NormalizedTransaction, back: NormalizedTransaction): Round | null {
  const closing = signerNet(back)
  const rounds: Round[] = []

  for (const [mint, opened] of signerNet(front)) {
    const closed = closing.get(mint) ?? 0n
    if (opened === 0n || closed === 0n || opened > 0n === closed > 0n) continue

    const frontSigner = holderOf(front, mint)
    const backSigner = holderOf(back, mint)
    if (frontSigner === null || backSigner === null) continue

    const openPool = largestCounterparty(front, frontSigner, mint, opened)
    const closePool = largestCounterparty(back, backSigner, mint, closed)
    if (openPool === null || closePool === null) continue

    const opening = poolSide(front, openPool, mint)
    const settled = poolSide(back, closePool, mint)
    // An unreadable price is a refusal, not a zero — as everywhere else here.
    if (opening === null || settled === null || !improved(opening, settled)) continue

    rounds.push({ mint, openPool, closePool, opened })
  }

  // Largest first, mint then pool breaking ties: one pair yields one row, and two runs
  // over the same slot must not disagree about which.
  return rounds.sort(byTrade)[0] ?? null
}

/** What the transaction's own signers ended up holding, by mint. */
function signerNet(transaction: NormalizedTransaction): Map<string, bigint> {
  const net = new Map<string, bigint>()
  for (const signer of transaction.signers) {
    for (const [mint, amount] of ownNet(transaction, signer)) {
      net.set(mint, (net.get(mint) ?? 0n) + amount)
    }
  }

  return net
}

/** Which of the signers holds the mint, when a transaction carries more than one. */
function holderOf(transaction: NormalizedTransaction, mint: string): string | null {
  return transaction.signers.find((signer) => netOf(transaction, signer, mint) !== 0n) ?? null
}

function describe(
  front: NormalizedTransaction,
  back: NormalizedTransaction,
  between: NormalizedTransaction[],
  round: Round,
): CrossRoundTrip {
  const touched: number[] = []
  const aligned: number[] = []

  for (const middle of between) {
    if (!middle.tokenDelta.some((delta) => delta.mint === round.mint)) continue
    touched.push(middle.index)

    let net = 0n
    for (const signer of middle.signers) net += netOf(middle, signer, round.mint)
    if (net !== 0n && net < 0n === round.opened < 0n) aligned.push(middle.index)
  }

  return {
    front: front.index,
    back: back.index,
    frontSigner: front.signers[0] ?? '',
    backSigner: back.signers[0] ?? '',
    between: between.map((middle) => middle.index),
    mint: round.mint,
    openPool: round.openPool,
    closePool: round.closePool,
    samePool: round.openPool === round.closePool,
    touched,
    aligned,
    size: absolute(round.opened),
  }
}

function sharesSigner(left: NormalizedTransaction, right: NormalizedTransaction): boolean {
  return left.signers.some((signer) => right.signers.includes(signer))
}

function byAddress(left: string, right: string): number {
  return left < right ? -1 : 1
}

function byTrade(left: Round, right: Round): number {
  const leftSize = absolute(left.opened)
  const rightSize = absolute(right.opened)
  if (leftSize !== rightSize) return leftSize > rightSize ? -1 : 1
  if (left.mint !== right.mint) return byAddress(left.mint, right.mint)

  return byAddress(left.openPool, right.openPool)
}
