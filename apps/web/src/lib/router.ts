/**
 * The whole router. Four screens and one parameter do not need a routing library,
 * and a hash route keeps the app deployable as static files with no server rewrite
 * rule — which is what M2 asks of Vercel.
 *
 * This file is pure on purpose: it reads a string and returns a route. Everything
 * that touches `window` lives in `useRoute.ts`, so the parsing can be tested without
 * a DOM and the tests need no jsdom dependency.
 */

export type Route =
  | { name: 'builder' }
  | { name: 'compare' }
  /** One triple, before and after. `triple` is 1-based — it is a label on screen. */
  | { name: 'attack'; triple: number }
  | { name: 'report' }
  | { name: 'notFound'; path: string }

/** The screens a person can reach from the navigation, in canvas order. */
export const NAVIGATION: ReadonlyArray<{ route: Route; label: string }> = [
  { route: { name: 'builder' }, label: 'Policy' },
  { route: { name: 'compare' }, label: 'Comparison' },
  { route: { name: 'attack', triple: 1 }, label: 'Attack' },
  { route: { name: 'report' }, label: 'Report' },
]

/**
 * `#/attack/3` → `{ name: 'attack', triple: 3 }`. Anything unrecognised becomes
 * `notFound` carrying the path, so the screen can print what was asked for instead
 * of silently redirecting somewhere the person did not type.
 */
export function parseRoute(hash: string): Route {
  const path = normalize(hash)
  const segments = path.split('/').filter((segment) => segment.length > 0)

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

/** The inverse of `parseRoute` for every route but `notFound`, which round-trips too. */
export function toHash(route: Route): string {
  switch (route.name) {
    case 'builder':
      return '#/'
    case 'compare':
      return '#/compare'
    case 'attack':
      return `#/attack/${route.triple}`
    case 'report':
      return '#/report'
    case 'notFound':
      return `#${route.path}`
  }
}

/** Whether the navigation entry for `candidate` should read as the current screen. */
export function isCurrent(current: Route, candidate: Route): boolean {
  return current.name === candidate.name
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
