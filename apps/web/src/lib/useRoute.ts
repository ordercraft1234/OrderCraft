import { useSyncExternalStore } from 'react'
import { type Route, parseRoute } from './router.ts'

/**
 * The current route, re-read on every `hashchange`.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the hash is state that
 * lives outside React, and the effect version renders once with a stale route before
 * the subscription catches up — visible on the first paint as the wrong screen.
 */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash)

  return parseRoute(hash)
}

/** Navigates without a full page load. Used by the navigation links. */
export function navigate(hash: string): void {
  window.location.hash = hash
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)

  return () => window.removeEventListener('hashchange', onChange)
}

function readHash(): string {
  return window.location.hash
}

/** No server rendering here; the value only has to be stable. */
function serverHash(): string {
  return '#/'
}
