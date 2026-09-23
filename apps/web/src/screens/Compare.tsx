import type { ReactNode } from 'react'
import { RibbonField } from '../components/RibbonField.tsx'
import { Screen } from '../components/Screen.tsx'
import { SourceNote } from '../components/SourceNote.tsx'
import { TimeModelNote } from '../components/TimeModelNote.tsx'
import type { PolicySession } from '../lib/usePolicySession.ts'
import { type RunView, useRun } from '../lib/useRun.ts'

const number = new Intl.NumberFormat('en-US')

/**
 * Artboard 2: one recorded block in two orderings.
 *
 * The policy is the one on the Policy screen — there is no second policy hiding here.
 * When it does not compile, the screen says which screen to go and fix, rather than
 * falling back to something that would run.
 *
 * Where the run itself is computed is `useRun`'s business, not this screen's: the
 * figures are the same either way and the screen prints which it was underneath.
 */
export function Compare({ session }: { session: PolicySession }) {
  const run = useRun(session.parsed, session.draftHash, session.markStored)

  if (run.status === 'loading') {
    return (
      <Screen title="Comparison" subtitle={LOADING[run.stage].subtitle}>
        <Note>{LOADING[run.stage].detail}</Note>
      </Screen>
    )
  }

  if (run.status === 'failed') {
    return (
      <Screen title="Comparison" subtitle="The run did not come back">
        <Note>{run.reason}</Note>
      </Screen>
    )
  }

  if (run.status === 'blocked') {
    return (
      <Screen title="Comparison">
        <Note>
          Nothing to compare yet: the policy on the Policy screen{' '}
          {run.reason === 'inert' ? 'would not order anything' : 'is not valid'}. This screen
          replays whatever that screen holds, and never a policy of its own.
        </Note>
      </Screen>
    )
  }

  return <Run view={run.view} />
}

const LOADING = {
  slot: {
    subtitle: 'Loading the recorded block',
    detail: 'Half a megabyte of gzip. It ships with the app — no network call goes out.',
  },
  run: {
    subtitle: 'Running the policy',
    detail:
      'The block is here; the ordering is being computed. On a free-plan API the first request after a quiet spell also has to wake the server.',
  },
} as const

function Run({ view }: { view: RunView }) {
  const { bundle, ordering, metrics } = view
  const identity = `Slot ${number.format(bundle.slot)} · ${number.format(bundle.transactions.length)} transactions · recorded`

  return (
    <Screen title="Comparison" subtitle={identity}>
      <div className="flex flex-col gap-6">
        <RibbonField ordering={ordering} recorded={bundle.transactions.length} />

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-3 text-[12px]">
          <Count label="moved" value={number.format(metrics.moved)} />
          <Count label="delayed" value={number.format(metrics.delayed)} />
          <Count label="dropped" value={number.format(metrics.dropped)} />
          <Count label="deferred" value={number.format(metrics.deferred)} />
          <Count label="reordered" value={`${(metrics.reorderedPerMille / 10).toFixed(1)} %`} />
          <Count
            label="added latency"
            value={`p50 ${metrics.addedDelayMs.p50} ms · p95 ${metrics.addedDelayMs.p95} ms · max ${metrics.addedDelayMs.max} ms`}
          />
        </div>

        <TimeModelNote recorded={bundle.transactions.length} />
        <SourceNote source={view.source} />

        <Note>
          Percentiles run over the {number.format(metrics.included)} transactions still in the
          block. A deferred transaction has no delay inside a block it is not in, so a policy that
          defers its worst cases reads well here — which is why deferred is printed beside them and
          not underneath.
        </Note>
      </div>
    </Screen>
  )
}

/** One figure in the row under the field. Hairlines separate them, not cards. */
function Count({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-[620px] text-[12px] text-muted">{children}</p>
}
