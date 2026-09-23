import { useSyncExternalStore } from 'react'
import { type Location, parseLocation, toHash } from './router.ts'

/**
 * The current location, re-read on every `hashchange`.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the hash is state that
 * lives outside React, and the effect version renders once with a stale route before
 * the subscription catches up — visible on the first paint as the wrong screen.
 */
export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash)

  return parseLocation(hash)
}

/** Navigates without a full page load. Used by the navigation links. */
export function navigate(hash: string): void {
  window.location.hash = hash
}

/**
 * The address to hand somebody else for a saved policy.
 *
 * Absolute, because it is meant to be copied out of this tab: the origin and path come
 * from wherever the app is served — a project page under `/OrderCraft/`, a custom
 * domain, or `localhost:5173` — and only the fragment is ours to write.
 */
export function policyLink(hash: string): string {
  const { origin, pathname, search } = window.location

  return `${origin}${pathname}${search}${toHash({ name: 'builder' }, hash)}`
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
