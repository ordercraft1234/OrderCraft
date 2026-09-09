import type { SlotBundle } from '@ordercraft/core'
import { loadSlotBundle } from '@ordercraft/fixtures'
import { useEffect, useState } from 'react'

export type SlotState =
  | { status: 'loading' }
  | { status: 'ready'; bundle: SlotBundle }
  | { status: 'failed'; reason: string }

/**
 * Loads the slot the repository ships. It is half a megabyte of gzip, so it is fetched
 * rather than bundled, and every screen that needs it gets the same one.
 *
 * There is no retry and no cache: a failure here means the asset is missing from the
 * deployment, which is a broken build rather than a bad moment, and saying so is more
 * use than a spinner that comes back.
 */
export function useDemoSlot(): SlotState {
  const [state, setState] = useState<SlotState>({ status: 'loading' })

  useEffect(() => {
    let live = true

    loadSlotBundle().then(
      (bundle) => {
        if (live) setState({ status: 'ready', bundle })
      },
      (error: unknown) => {
        if (live) setState({ status: 'failed', reason: messageOf(error) })
      },
    )

    return () => {
      live = false
    }
  }, [])

  return state
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
