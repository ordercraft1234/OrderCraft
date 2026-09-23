import type { ExtractedValue, Sandwich, SlotBundle, TripleOutcome } from '@ordercraft/core'
import type { ReactNode } from 'react'
import { AttackField } from '../components/AttackField.tsx'
import { Screen } from '../components/Screen.tsx'
import { SourceNote } from '../components/SourceNote.tsx'
import { TimeModelNote } from '../components/TimeModelNote.tsx'
import { attackWindow } from '../lib/attackWindow.ts'
import { toHash } from '../lib/router.ts'
import type { PolicySession } from '../lib/usePolicySession.ts'
import { type RunView, useRun } from '../lib/useRun.ts'

const number = new Intl.NumberFormat('en-US')

interface AttackProps {
  /** Which triple of the run to open. 1-based, as printed. */
  triple: number
  session: PolicySession
  /** The stored policy the links on this screen should carry, or `null`. */
  policyHash: string | null
}

/** Artboard 3: one triple, before and after, on the detector from T025–T028. */
export function Attack({ triple, session, policyHash }: AttackProps) {
  const run = useRun(session.parsed, session.draftHash, session.markStored)

  if (run.status === 'loading') {
    return (
      <Screen title="One attack, before and after" subtitle={`Triple ${triple}`}>
        <Note>
          {run.stage === 'slot' ? 'Loading the recorded block.' : 'Running the policy on it.'}
        </Note>
      </Screen>
    )
  }

  if (run.status === 'failed') {
    return (
      <Screen title="One attack, before and after" subtitle={`Triple ${triple}`}>
        <Note>{run.reason}</Note>
      </Screen>
    )
  }

  if (run.status === 'blocked') {
    return (
      <Screen title="One attack, before and after" subtitle={`Triple ${triple}`}>
        <Note>
          The policy on the Policy screen does not run yet, and this screen is about what a policy
          did to a triple. Fix it there and come back.
        </Note>
      </Screen>
    )
  }

  return <Found view={run.view} triple={triple} policyHash={policyHash} />
}

/**
 * The triple and its verdict come out of the run rather than being recomputed here.
 *
 * `outcomes[i]` is the fate of `attacks[i]` — the contract guarantees the two are the
 * same length, and reading them as a pair is what keeps the verdict under the legs from
 * belonging to a different triple than the one on screen.
 */
function Found({
  view,
  triple,
  policyHash,
}: { view: RunView; triple: number; policyHash: string | null }) {
  const { bundle, ordering, attacks, outcomes } = view
  const attack = attacks[triple - 1]
  const outcome = outcomes[triple - 1]
  const identity = `Slot ${number.format(bundle.slot)} · ${attacks.length} triple${attacks.length === 1 ? '' : 's'} marked`

  if (attack === undefined || outcome === undefined) {
    return (
      <Screen title="One attack, before and after" subtitle={identity}>
        <Note>
          {attacks.length === 0
            ? 'The detector marked no triple in this block. It looks for the same party either side of somebody else, on one pool, trading in opposite directions — and before it says so it asks three more things: that the party in the middle traded the same way the first leg did, that the round trip closed at a better price than it opened, and that the two legs matched in size.'
            : `There is no triple ${triple} here. ${attacks.length} were marked.`}
        </Note>
        {attacks.length === 0 ? null : (
          <TripleLinks count={attacks.length} current={triple} policyHash={policyHash} />
        )}
      </Screen>
    )
  }

  const rows = attackWindow(attack, ordering, bundle.transactions.length)

  return (
    <Screen title="One attack, before and after" subtitle={identity}>
      <div className="flex flex-col gap-6">
        <TripleLinks count={attacks.length} current={triple} policyHash={policyHash} />
        <Legs bundle={bundle} sandwich={attack} value={attack.extracted} />
        <AttackField rows={rows} />
        <Baseline sandwich={attack} value={attack.extracted} />
        <UnderPolicy outcome={outcome} />
        <TimeModelNote recorded={bundle.transactions.length} />
        <SourceNote source={view.source} />
      </div>
    </Screen>
  )
}

/** The three transactions, named, with what the attacker ended the triple holding. */
function Legs({
  bundle,
  sandwich,
  value,
}: { bundle: SlotBundle; sandwich: Sandwich; value: ExtractedValue }) {
  const legs = [
    { role: 'front-run', index: sandwich.front, shared: true },
    ...sandwich.victims.map((index) => ({ role: 'victim', index, shared: false })),
    { role: 'back-run', index: sandwich.back, shared: true },
  ]

  return (
    <div className="flex flex-col border-t border-hairline">
      {legs.map((leg) => {
        const transaction = bundle.transactions[leg.index]

        return (
          <div
            key={leg.index}
            className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline py-2 text-[12px]"
          >
            <span className="w-[88px] text-[11px] uppercase tracking-[0.16em] text-muted">
              {leg.role}
            </span>
            <span className="tabular-nums">#{number.format(leg.index)}</span>
            {/*
              The legs print the signer the detector matched them on, not the first one
              the transaction lists. A Solana transaction can carry several signers, and
              on triple 2 of the shipped slot the legs' first signers are two different
              addresses — so the screen was showing different parties either side of the
              victim while asserting underneath that they were the same party.
            */}
            <span className="text-muted">
              signer {short(leg.shared ? sandwich.signer : transaction?.signers[0])}
            </span>
            <span className="text-muted">sig {short(transaction?.signature)}</span>
          </div>
        )
      })}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-2 text-[12px]">
        <span className="w-[88px] text-[11px] uppercase tracking-[0.16em] text-muted">net</span>
        <span className="text-extracted tabular-nums">{netOf(value)}</span>
        <span className="text-muted">fees {number.format(Number(value.fees))} lamports</span>
      </div>
    </div>
  )
}

function Baseline({ sandwich, value }: { sandwich: Sandwich; value: ExtractedValue }) {
  const victims = sandwich.victims.length

  return (
    <Note>
      In the block as recorded, {short(sandwich.signer)} sits at #{number.format(sandwich.front)}{' '}
      and again at #{number.format(sandwich.back)}, with{' '}
      {victims === 1 ? 'one transaction' : `${victims} transactions`} by somebody else between them,
      all of them touching the same account. Across the three, the accounts that signer owns ended{' '}
      {netOf(value)}. That is arithmetic on the balances the chain wrote, not an estimate of what
      anyone would have traded at in another order.
    </Note>
  )
}

/**
 * What the policy did, in the words the product is allowed to use. When nothing broke,
 * the sentence says the attack remains possible — in plain ink, not softened, and never
 * moved to the bottom of the screen.
 */
function UnderPolicy({ outcome }: { outcome: TripleOutcome }) {
  if (!outcome.broken) {
    return (
      <p className="max-w-[620px] text-[12px]">
        Under this policy the attack remains possible: the three are still in the block, still in
        that order, and still settle at different times.
      </p>
    )
  }

  return (
    <p className="max-w-[620px] text-[12px]">
      {REASONS[outcome.reason ?? 'orderChanged']}
      {outcome.by === null ? '' : ` The primitive that did it: ${PRIMITIVE_NAMES[outcome.by]}.`}
    </p>
  )
}

const REASONS: Record<NonNullable<TripleOutcome['reason']>, string> = {
  // The consequence has to differ from `victimsLeftBlock` below, or the screen tells the
  // same story for two mechanisms `broken.ts` keeps deliberately apart. A leg leaving
  // ends the pair; the victims leaving leaves the pair intact with nobody in between.
  legLeftBlock:
    'Under this policy one of the two legs is no longer in the block, so there is no pair left to surround anybody.',
  victimsLeftBlock:
    'Under this policy every transaction the pair was built around has left the block, so there is nothing left between the legs.',
  sameBatch:
    'Under this policy all three settle in one batch. Their positions on screen are unchanged — inside a settlement group this model has no before and after to give an attacker.',
  orderChanged:
    'Under this policy the three are no longer in that order: nobody else is left between the two legs.',
}

const PRIMITIVE_NAMES = {
  speedBump: 'speed bump',
  batchAuction: 'batch auction',
  allowDeny: 'allow / deny',
} as const

function TripleLinks({
  count,
  current,
  policyHash,
}: { count: number; current: number; policyHash: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 text-[12px] text-muted">
      <span className="text-[11px] uppercase tracking-[0.16em]">triples</span>
      {Array.from({ length: count }, (_, position) => position + 1).map((triple) => (
        <a
          key={triple}
          href={toHash({ name: 'attack', triple }, policyHash)}
          className={
            triple === current ? 'text-ink' : 'underline underline-offset-4 hover:text-ink'
          }
        >
          {triple}
        </a>
      ))}
    </div>
  )
}

/**
 * The net as a vector, in base units. No decimals: a slot records amounts, never how
 * many places a mint divides into, and a number scaled by a guess would be a made-up
 * figure on a screen whose whole claim is that its figures are not made up.
 */
function netOf(value: ExtractedValue): string {
  const tokens = value.tokens.map((token) => `${signed(token.amount)} ${short(token.mint)}`)
  if (value.lamports !== 0n) tokens.push(`${signed(value.lamports)} lamports`)

  return tokens.length === 0 ? 'exactly where it started' : tokens.join(' · ')
}

function signed(amount: bigint): string {
  return `${amount > 0n ? '+' : ''}${number.format(amount)}`
}

function short(address: string | undefined): string {
  if (address === undefined) return '—'

  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-[620px] text-[12px] text-muted">{children}</p>
}
