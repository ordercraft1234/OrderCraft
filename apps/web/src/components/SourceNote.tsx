import { api } from '../lib/api.ts'
import type { RunSource } from '../lib/useRun.ts'

/**
 * Where the figures above came from, on every screen that prints figures.
 *
 * It is not a disclaimer. The two paths run the same kernel in the same order, so the
 * numbers do not differ — what differs is whether anything was kept: a stored run has
 * an address somebody else can open, a run computed in this tab ends with the tab. A
 * person about to send a link needs to know which of those they are looking at.
 */
export function SourceNote({ source }: { source: RunSource }) {
  if (source === 'api' && api !== null) {
    return (
      <p className="max-w-[620px] text-[12px] text-muted">
        Computed and stored by the API at {api.url}. A second run of the same policy on the same
        slot returns this one rather than recomputing it.
      </p>
    )
  }

  return (
    <p className="max-w-[620px] text-[12px] text-muted">
      Computed in this tab, on the slot the repository ships. Nothing is stored and there is no link
      to share — this build has no API address.
    </p>
  )
}
