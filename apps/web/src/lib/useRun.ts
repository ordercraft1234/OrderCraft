import {
  type Ordering,
  type Policy,
  type RunMetrics,
  type SlotBundle,
  type TripleOutcome,
  apply,
  extractedValue,
  findSandwiches,
  runMetrics,
  tripleOutcome,
  validatePolicy,
} from '@ordercraft/core'
import { type Attack, hydrateOrdering } from '@ordercraft/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type ApiClient, ApiFailure, api } from './api.ts'
import type { DraftResult } from './policyDraft.ts'
import { useDemoSlot } from './useDemoSlot.ts'

/** One policy against one recorded block: the same four answers from either source. */
export interface RunView {
  bundle: SlotBundle
  ordering: Ordering
  /** What the detector marked on the block as recorded, with what each triple took. */
  attacks: readonly Attack[]
  /** `outcomes[i]` is the fate of `attacks[i]` — one per triple, by construction. */
  outcomes: readonly TripleOutcome[]
  metrics: RunMetrics
  /** Where the numbers came from. The screens print this; it is not a detail. */
  source: RunSource
}

export type RunSource = 'local' | 'api'

export type RunState =
  /** `slot` is the half megabyte of recorded block; `run` is the policy against it. */
  | { status: 'loading'; stage: 'slot' | 'run' }
  /** The policy cannot be run, and which of the two reasons it is. */
  | { status: 'blocked'; reason: 'invalid' | 'inert' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; view: RunView }

type RunData = Omit<RunView, 'bundle'>

/**
 * One run per `(policy, slot)` for the life of the page.
 *
 * The comparison and the attack screen ask the same question of the same policy, and
 * a person moving between them should not wait for a second round trip — nor should
 * the API store a second identical run to hand back. A failed attempt is dropped so
 * that returning to the screen tries again: the usual failure here is a free-tier API
 * waking up.
 */
const runs = new Map<string, Promise<RunData>>()

/**
 * The run behind the comparison and attack screens, from the API when this build has
 * one and from the kernel in this tab when it does not.
 *
 * Both paths call the same functions in the same order — `apps/api` computes a run with
 * `findSandwiches`, `apply`, `tripleOutcome` and `runMetrics`, exactly as `localRun`
 * below does — so the numbers do not depend on which one answered. That is `SC-002`
 * being relied upon rather than merely asserted, and it is why the screens can print
 * where the run came from as a fact about storage rather than a warning about accuracy.
 */
export function useRun(
  parsed: DraftResult,
  hash: string | null,
  onStored: (hash: string) => void,
): RunState {
  const slot = useDemoSlot()
  const policy = parsed.ok ? parsed.policy : null
  const runnable = useMemo(() => policy !== null && validatePolicy(policy).runnable, [policy])
  const bundle = slot.status === 'ready' ? slot.bundle : null
  const [state, setState] = useState<RunState>({ status: 'loading', stage: 'run' })

  // The callback is read at resolution time rather than depended on, so that a parent
  // re-rendering cannot restart a run that is already in flight.
  const stored = useRef(onStored)
  stored.current = onStored

  useEffect(() => {
    if (policy === null || hash === null || bundle === null || !runnable) return

    let live = true
    setState({ status: 'loading', stage: 'run' })

    runFor(policy, hash, bundle).then(
      (data) => {
        if (!live) return
        if (data.source === 'api') stored.current(hash)
        setState({ status: 'ready', view: { ...data, bundle } })
      },
      (error: unknown) => {
        if (live) setState({ status: 'failed', reason: messageOf(error) })
      },
    )

    return () => {
      live = false
    }
  }, [policy, hash, bundle, runnable])

  if (slot.status === 'loading') return { status: 'loading', stage: 'slot' }
  if (slot.status === 'failed') return { status: 'failed', reason: slot.reason }
  if (!parsed.ok) return { status: 'blocked', reason: 'invalid' }
  if (!runnable) return { status: 'blocked', reason: 'inert' }

  return state
}

function runFor(policy: Policy, hash: string, bundle: SlotBundle): Promise<RunData> {
  const key = `${hash}:${bundle.slot}`
  const cached = runs.get(key)
  if (cached !== undefined) return cached

  const pending =
    api === null ? Promise.resolve(localRun(policy, bundle)) : remoteRun(api, policy, hash, bundle)

  runs.set(key, pending)
  pending.catch(() => runs.delete(key))

  return pending
}

/**
 * The kernel, in this tab. No storage, no link, and no slot but the one the repository
 * ships — which is the whole of what a clean clone can do, and enough to show a block
 * reordered (SC-009).
 */
function localRun(policy: Policy, bundle: SlotBundle): RunData {
  const sandwiches = findSandwiches(bundle)
  const ordering = apply(policy, bundle)

  return {
    ordering,
    attacks: sandwiches.map((sandwich) => ({
      ...sandwich,
      extracted: extractedValue(bundle, sandwich),
    })),
    outcomes: sandwiches.map((sandwich) => tripleOutcome(sandwich, ordering)),
    metrics: runMetrics(bundle, ordering),
    source: 'local',
  }
}

/**
 * Saving is part of running: a run is addressed by a stored policy, so `POST /runs`
 * has nothing to look up until the body is on the server. Both calls are idempotent on
 * content, so this is at most two round trips and never a second row.
 *
 * The hash the server answers with is checked against the one this build computed. They
 * are two independent canonicalisations of the same body (FR-004), and if they ever
 * disagree, every link in the app points somewhere other than what is on screen — which
 * has to stop here rather than become a shared address for the wrong policy.
 */
async function remoteRun(
  client: ApiClient,
  policy: Policy,
  hash: string,
  bundle: SlotBundle,
): Promise<RunData> {
  const saved = await client.savePolicy(policy)
  if (saved.hash !== hash) {
    throw new ApiFailure(
      'MALFORMED',
      `the API addressed this policy as ${saved.hash.slice(0, 12)} and this build as ${hash.slice(0, 12)}: the two are not canonicalising the same body the same way`,
    )
  }

  const run = await client.requestRun(saved.hash, bundle.slot)

  return {
    ordering: hydrateOrdering(run.result.ordering, bundle),
    attacks: run.baseline.attacks,
    outcomes: run.result.outcomes,
    metrics: run.metrics,
    source: 'api',
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
