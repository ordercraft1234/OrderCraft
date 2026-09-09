import { type SlotBundle, apply, runMetrics, validatePolicy } from '@ordercraft/core'
import { type ReactNode, useMemo } from 'react'
import { RibbonField } from '../components/RibbonField.tsx'
import { Screen } from '../components/Screen.tsx'
import { type PolicyDraft, toPolicy } from '../lib/policyDraft.ts'
import { useDemoSlot } from '../lib/useDemoSlot.ts'

const number = new Intl.NumberFormat('en-US')

/**
 * Artboard 2: one recorded block in two orderings.
 *
 * The policy is the one on the Policy screen — there is no second policy hiding here.
 * When it does not compile, the screen says which screen to go and fix, rather than
 * falling back to something that would run.
 */
export function Compare({ draft }: { draft: PolicyDraft }) {
  const slot = useDemoSlot()
  const parsed = useMemo(() => toPolicy(draft), [draft])

  if (slot.status === 'loading') {
    return (
      <Screen title="Comparison" subtitle="Loading the recorded block">
        <Note>Half a megabyte of gzip. It ships with the app — no network call goes out.</Note>
      </Screen>
    )
  }

  if (slot.status === 'failed') {
    return (
      <Screen title="Comparison" subtitle="The recorded block did not load">
        <Note>{slot.reason}</Note>
      </Screen>
    )
  }

  return <Run bundle={slot.bundle} parsed={parsed} />
}

function Run({ bundle, parsed }: { bundle: SlotBundle; parsed: ReturnType<typeof toPolicy> }) {
  const identity = `Slot ${number.format(bundle.slot)} · ${number.format(bundle.transactions.length)} transactions · recorded`

  // Both validators, same order as the builder: the schema decides whether this is a
  // policy, `validatePolicy` whether it would order anything. `apply` throws on the
  // second, so the screen answers it before asking.
  const validation = parsed.ok ? validatePolicy(parsed.policy) : null
  const result = useMemo(
    () => (parsed.ok && validation?.runnable === true ? apply(parsed.policy, bundle) : null),
    [parsed, validation?.runnable, bundle],
  )
  const metrics = useMemo(
    () => (result === null ? null : runMetrics(bundle, result)),
    [bundle, result],
  )

  if (result === null || metrics === null) {
    return (
      <Screen title="Comparison" subtitle={identity}>
        <Note>
          Nothing to compare yet: the policy on the Policy screen{' '}
          {parsed.ok ? 'would not order anything' : 'is not valid'}. This screen replays whatever
          that screen holds, and never a policy of its own.
        </Note>
      </Screen>
    )
  }

  return (
    <Screen title="Comparison" subtitle={identity}>
      <div className="flex flex-col gap-6">
        <RibbonField ordering={result} recorded={bundle.transactions.length} />

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
