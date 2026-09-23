/**
 * The whole router. Four screens, one parameter and one prefix do not need a routing
 * library, and a hash route keeps the app deployable as static files with no server
 * rewrite rule — which is what GitHub Pages gives and all it gives.
 *
 * This file is pure on purpose: it reads a string and returns a location. Everything
 * that touches `window` lives in `useLocation.ts`, so the parsing can be tested without
 * a DOM and the tests need no jsdom dependency.
 */

export type Route =
  | { name: 'builder' }
  | { name: 'compare' }
  /** One triple, before and after. `triple` is 1-based — it is a label on screen. */
  | { name: 'attack'; triple: number }
  | { name: 'report' }
  | { name: 'notFound'; path: string }

/**
 * A screen, plus the saved policy the address names.
 *
 * `#/p/<hash>/compare` is the comparison of a stored policy; `#/compare` is the
 * comparison of whatever this tab holds. The prefix is what makes a policy shareable
 * (FR-020): whoever has the address sees the policy and its runs, on any of the four
 * screens rather than only on the first.
 */
export interface Location {
  /** The stored policy's content address, or `null` when the link carries none. */
  policyHash: string | null
  route: Route
}

/** The screens a person can reach from the navigation, in canvas order. */
export const NAVIGATION: ReadonlyArray<{ route: Route; label: string }> = [
  { route: { name: 'builder' }, label: 'Policy' },
  { route: { name: 'compare' }, label: 'Comparison' },
  { route: { name: 'attack', triple: 1 }, label: 'Attack' },
  { route: { name: 'report' }, label: 'Report' },
]

/** What `policyHash` produces: 64 lower-case hex characters, as `@ordercraft/shared` says. */
const POLICY_HASH = /^[0-9a-f]{64}$/

/**
 * `#/p/<hash>/attack/3` → that triple, of that stored policy. Anything unrecognised
 * becomes `notFound` carrying the whole path as typed, so the screen can print what was
 * asked for instead of silently redirecting somewhere nobody typed.
 *
 * A `/p/` prefix whose hash is malformed is `notFound` rather than a prefix-less route:
 * the address claimed to name a policy and did not, and opening the demo instead would
 * answer a broken link with somebody else's policy.
 */
export function parseLocation(hash: string): Location {
  const path = normalize(hash)
  const segments = path.split('/').filter((segment) => segment.length > 0)

  if (segments[0] !== 'p') return { policyHash: null, route: routeOf(segments, path) }

  const candidate = segments[1]
  if (candidate === undefined || !POLICY_HASH.test(candidate)) {
    return { policyHash: null, route: { name: 'notFound', path } }
  }

  return { policyHash: candidate, route: routeOf(segments.slice(2), path) }
}

/**
 * The inverse of `parseLocation` for every route but `notFound`, which carries its
 * whole path — prefix included — and so round-trips through the path alone.
 */
export function toHash(route: Route, policyHash: string | null = null): string {
  const prefix = policyHash === null ? '' : `/p/${policyHash}`

  switch (route.name) {
    case 'builder':
      return `#${prefix === '' ? '/' : prefix}`
    case 'compare':
      return `#${prefix}/compare`
    case 'attack':
      return `#${prefix}/attack/${route.triple}`
    case 'report':
      return `#${prefix}/report`
    case 'notFound':
      return `#${route.path}`
  }
}

/** Whether the navigation entry for `candidate` should read as the current screen. */
export function isCurrent(current: Route, candidate: Route): boolean {
  return current.name === candidate.name
}

function routeOf(segments: string[], path: string): Route {
  if (segments.length === 0) return { name: 'builder' }

  const [head, second, ...rest] = segments
  if (rest.length > 0) return { name: 'notFound', path }

  if (head === 'compare' && second === undefined) return { name: 'compare' }
  if (head === 'report' && second === undefined) return { name: 'report' }

  if (head === 'attack' && second !== undefined) {
    const triple = positiveInteger(second)
    if (triple !== null) return { name: 'attack', triple }
  }

  return { name: 'notFound', path }
}

/**
 * Strips the leading `#` and any query or nested fragment, and guarantees a leading
 * slash. `''`, `'#'` and `'#/'` all mean the first screen.
 */
function normalize(hash: string): string {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  const withoutQuery = withoutHash.split('?')[0] ?? ''
  const path = withoutQuery.split('#')[0] ?? ''

  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Digits only. `Number('1e3')` and `Number(' 2 ')` both parse, and a route that
 * accepted them would put a string on screen that nobody typed.
 */
function positiveInteger(segment: string): number | null {
  if (!/^[1-9][0-9]{0,3}$/.test(segment)) return null

  return Number(segment)
}
