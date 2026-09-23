import { describe, expect, it } from 'vitest'
import { NAVIGATION, type Route, isCurrent, parseLocation, toHash } from '../src/lib/router.ts'

/** A well-formed content address; the digits are not meaningful, only the shape is. */
const HASH = 'a'.repeat(64)

/** The route half of a location, for the cases where the prefix is not what is under test. */
function routeOf(hash: string): Route {
  return parseLocation(hash).route
}

describe('parseLocation', () => {
  it('treats an empty hash as the first screen', () => {
    expect(parseLocation('')).toEqual({ policyHash: null, route: { name: 'builder' } })
    expect(parseLocation('#')).toEqual({ policyHash: null, route: { name: 'builder' } })
    expect(parseLocation('#/')).toEqual({ policyHash: null, route: { name: 'builder' } })
  })

  it('reads the flat screens', () => {
    expect(routeOf('#/compare')).toEqual({ name: 'compare' })
    expect(routeOf('#/report')).toEqual({ name: 'report' })
  })

  it('reads the triple index of an attack route', () => {
    expect(routeOf('#/attack/1')).toEqual({ name: 'attack', triple: 1 })
    expect(routeOf('#/attack/7')).toEqual({ name: 'attack', triple: 7 })
  })

  it('ignores a query string and a trailing slash', () => {
    expect(routeOf('#/compare?from=report')).toEqual({ name: 'compare' })
    expect(routeOf('#/compare/')).toEqual({ name: 'compare' })
  })

  it('refuses a triple index that is not plain digits', () => {
    // `Number` accepts every one of these. A route that used it would print a triple
    // number nobody typed.
    for (const segment of ['0', '1e3', ' 2 ', '2.0', '-1', '01', '0x3', '']) {
      expect(routeOf(`#/attack/${segment}`).name).toBe('notFound')
    }
  })

  it('reports an unknown path rather than falling back to a screen', () => {
    expect(routeOf('#/nope')).toEqual({ name: 'notFound', path: '/nope' })
    expect(routeOf('#/attack/1/extra')).toEqual({ name: 'notFound', path: '/attack/1/extra' })
    expect(routeOf('#/compare/1')).toEqual({ name: 'notFound', path: '/compare/1' })
  })

  it('accepts a path with no leading slash', () => {
    expect(routeOf('#report')).toEqual({ name: 'report' })
  })
})

describe('the policy prefix', () => {
  it('carries a saved policy onto every screen', () => {
    expect(parseLocation(`#/p/${HASH}`)).toEqual({
      policyHash: HASH,
      route: { name: 'builder' },
    })
    expect(parseLocation(`#/p/${HASH}/compare`)).toEqual({
      policyHash: HASH,
      route: { name: 'compare' },
    })
    expect(parseLocation(`#/p/${HASH}/attack/2`)).toEqual({
      policyHash: HASH,
      route: { name: 'attack', triple: 2 },
    })
  })

  it('is absent from an address that does not carry one', () => {
    expect(parseLocation('#/compare').policyHash).toBeNull()
  })

  /**
   * A malformed prefix is not a route without a prefix. The address said it named a
   * policy and did not, and answering it with the demo would show somebody a policy
   * they did not ask for while their link quietly did nothing.
   */
  it('refuses an address that claims a policy and does not name one', () => {
    for (const segment of ['', 'abc', HASH.toUpperCase(), `${HASH}0`, HASH.slice(0, 63)]) {
      const location = parseLocation(`#/p/${segment}/compare`)

      expect(location.policyHash).toBeNull()
      expect(location.route.name).toBe('notFound')
    }
  })

  it('reports the whole path when the screen under a valid prefix is unknown', () => {
    expect(parseLocation(`#/p/${HASH}/nope`)).toEqual({
      policyHash: HASH,
      route: { name: 'notFound', path: `/p/${HASH}/nope` },
    })
  })
})

describe('toHash', () => {
  const routes: Route[] = [
    { name: 'builder' },
    { name: 'compare' },
    { name: 'attack', triple: 3 },
    { name: 'report' },
  ]

  it('round-trips every route, with and without a policy', () => {
    for (const route of routes) {
      expect(parseLocation(toHash(route))).toEqual({ policyHash: null, route })
      expect(parseLocation(toHash(route, HASH))).toEqual({ policyHash: HASH, route })
    }
  })

  /** `notFound` carries its whole path, prefix included, so it round-trips through that. */
  it('round-trips an unknown path', () => {
    const route: Route = { name: 'notFound', path: '/nope' }

    expect(parseLocation(toHash(route)).route).toEqual(route)
  })

  it('gives every navigation entry a hash that leads back to it', () => {
    for (const entry of NAVIGATION) {
      expect(parseLocation(toHash(entry.route)).route.name).toBe(entry.route.name)
      expect(parseLocation(toHash(entry.route, HASH)).policyHash).toBe(HASH)
    }
  })
})

describe('isCurrent', () => {
  it('marks the attack entry current whichever triple is open', () => {
    expect(isCurrent({ name: 'attack', triple: 5 }, { name: 'attack', triple: 1 })).toBe(true)
  })

  it('does not mark a different screen current', () => {
    expect(isCurrent({ name: 'compare' }, { name: 'builder' })).toBe(false)
  })
})
