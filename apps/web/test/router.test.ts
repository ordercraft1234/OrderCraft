import { describe, expect, it } from 'vitest'
import { NAVIGATION, type Route, isCurrent, parseRoute, toHash } from '../src/lib/router.ts'

describe('parseRoute', () => {
  it('treats an empty hash as the first screen', () => {
    expect(parseRoute('')).toEqual({ name: 'builder' })
    expect(parseRoute('#')).toEqual({ name: 'builder' })
    expect(parseRoute('#/')).toEqual({ name: 'builder' })
  })

  it('reads the flat screens', () => {
    expect(parseRoute('#/compare')).toEqual({ name: 'compare' })
    expect(parseRoute('#/report')).toEqual({ name: 'report' })
  })

  it('reads the triple index of an attack route', () => {
    expect(parseRoute('#/attack/1')).toEqual({ name: 'attack', triple: 1 })
    expect(parseRoute('#/attack/7')).toEqual({ name: 'attack', triple: 7 })
  })

  it('ignores a query string and a trailing slash', () => {
    expect(parseRoute('#/compare?from=report')).toEqual({ name: 'compare' })
    expect(parseRoute('#/compare/')).toEqual({ name: 'compare' })
  })

  it('refuses a triple index that is not plain digits', () => {
    // `Number` accepts every one of these. A route that used it would print a triple
    // number nobody typed.
    for (const segment of ['0', '1e3', ' 2 ', '2.0', '-1', '01', '0x3', '']) {
      expect(parseRoute(`#/attack/${segment}`).name).toBe('notFound')
    }
  })

  it('reports an unknown path rather than falling back to a screen', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'notFound', path: '/nope' })
    expect(parseRoute('#/attack/1/extra')).toEqual({ name: 'notFound', path: '/attack/1/extra' })
    expect(parseRoute('#/compare/1')).toEqual({ name: 'notFound', path: '/compare/1' })
  })

  it('accepts a path with no leading slash', () => {
    expect(parseRoute('#report')).toEqual({ name: 'report' })
  })
})

describe('toHash', () => {
  const routes: Route[] = [
    { name: 'builder' },
    { name: 'compare' },
    { name: 'attack', triple: 3 },
    { name: 'report' },
    { name: 'notFound', path: '/nope' },
  ]

  it('round-trips every route', () => {
    for (const route of routes) {
      expect(parseRoute(toHash(route))).toEqual(route)
    }
  })

  it('gives every navigation entry a hash that leads back to it', () => {
    for (const entry of NAVIGATION) {
      expect(parseRoute(toHash(entry.route)).name).toBe(entry.route.name)
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
