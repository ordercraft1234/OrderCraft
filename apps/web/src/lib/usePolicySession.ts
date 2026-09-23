import { policyHash } from '@ordercraft/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.ts'
import { demoDraft } from './demoPolicy.ts'
import { type DraftResult, type PolicyDraft, policyToDraft, toPolicy } from './policyDraft.ts'

/** What became of the attempt to open the policy an address named. */
export type PolicyLoad =
  | { status: 'idle' }
  | { status: 'loading'; hash: string }
  | { status: 'failed'; hash: string; reason: string }

export interface PolicySession {
  draft: PolicyDraft
  /** `toPolicy(draft)`, computed once for every screen that needs it. */
  parsed: DraftResult
  /** The draft's content address, or `null` while the draft is not yet a policy. */
  draftHash: string | null
  /** Whether this exact content is known to be stored, and so has a link. */
  stored: boolean
  load: PolicyLoad
  edit: (draft: PolicyDraft) => void
  /** Called by whoever saved it — the builder's button, or the run that stored it first. */
  markStored: (hash: string) => void
}

/**
 * The policy this tab is working on, and its relationship to the address bar.
 *
 * Three rules, and the second is the one worth stating out loud:
 *
 * 1. An address naming a stored policy loads it, once. The tab opens on the demo
 *    policy while that is in flight, so the screens have to look at `load` rather than
 *    draw whatever the draft happens to be.
 * 2. **Editing never re-reads the address.** The link in the bar goes stale the moment
 *    somebody types, and the alternative — reloading the stored body over the edit —
 *    would mean the address bar can discard what a person wrote. It cannot. The link
 *    is dropped from the navigation instead, so nothing offers a link to a policy that
 *    is no longer on screen.
 * 3. `stored` is about the content, not about the session: it is true when the current
 *    draft hashes to something we have seen the API acknowledge. Editing away from a
 *    saved policy and back again gives the link back without another round trip.
 */
export function usePolicySession(linkHash: string | null): PolicySession {
  const [draft, setDraft] = useState<PolicyDraft>(demoDraft)
  const [load, setLoad] = useState<PolicyLoad>({ status: 'idle' })
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set())
  const handled = useRef<string | null>(null)

  const parsed = useMemo(() => toPolicy(draft), [draft])
  const draftHash = useMemo(() => (parsed.ok ? policyHash(parsed.policy) : null), [parsed])

  const markStored = useCallback((hash: string) => {
    handled.current = hash
    setKnown((current) => new Set(current).add(hash))
  }, [])

  useEffect(() => {
    if (linkHash === null) {
      // The address no longer names a policy, so neither the wait nor the complaint
      // about the last one is about anything. Leaving a failure up here showed "that
      // link did not open" on top of a screen reached by a link that no longer exists.
      setLoad((current) => (current.status === 'idle' ? current : { status: 'idle' }))
      return
    }
    if (linkHash === handled.current) return

    if (api === null) {
      setLoad({
        status: 'failed',
        hash: linkHash,
        reason: 'this build has no API address, so a saved policy cannot be opened',
      })
      return
    }

    let live = true
    setLoad({ status: 'loading', hash: linkHash })

    api.readPolicyVersion(linkHash).then(
      (version) => {
        if (!live) return
        // Marked handled only once it arrived: a load that was cancelled or refused
        // left the draft untouched, and coming back to the same address should try
        // again rather than show whatever this tab happened to hold.
        handled.current = version.hash
        setDraft(policyToDraft(version.body))
        setKnown((current) => new Set(current).add(version.hash))
        setLoad({ status: 'idle' })
      },
      (error: unknown) => {
        if (!live) return
        setLoad({ status: 'failed', hash: linkHash, reason: messageOf(error) })
      },
    )

    return () => {
      live = false
    }
  }, [linkHash])

  const edit = useCallback((next: PolicyDraft) => {
    setDraft(next)
    // A failure belongs to the address that caused it. Once somebody edits, the screen
    // is about their policy again and the old complaint would be about nothing.
    setLoad((current) => (current.status === 'failed' ? { status: 'idle' } : current))
  }, [])

  return {
    draft,
    parsed,
    draftHash,
    stored: draftHash !== null && known.has(draftHash),
    load,
    edit,
    markStored,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
