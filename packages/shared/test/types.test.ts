import type {
  ExtractedValue,
  Placement,
  RunMetrics,
  Sandwich,
  TripleOutcome,
} from '@ordercraft/core'
import { describe, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { ApiError } from '../src/error.ts'
import type {
  Attack,
  PlacementWire,
  extractedValueSchema,
  runMetricsSchema,
  tripleOutcomeSchema,
} from '../src/runs.ts'

/**
 * The wire types are declared twice on purpose — once as a schema here, once as a type
 * in the kernel — and these assertions are what keeps the two copies the same. They
 * fail at `tsc`, which the gate runs; the `it` blocks exist so the file has a reason to
 * be under `test/`.
 */
describe('wire types match the kernel', () => {
  it('RunMetrics', () => {
    expectTypeOf<z.infer<typeof runMetricsSchema>>().toEqualTypeOf<RunMetrics>()
  })

  it('TripleOutcome', () => {
    expectTypeOf<z.infer<typeof tripleOutcomeSchema>>().toEqualTypeOf<TripleOutcome>()
  })

  it('ExtractedValue', () => {
    expectTypeOf<z.infer<typeof extractedValueSchema>>().toEqualTypeOf<ExtractedValue>()
  })

  it('Attack is a Sandwich with its value', () => {
    expectTypeOf<Omit<Attack, 'extracted'>>().toEqualTypeOf<Sandwich>()
  })

  it('PlacementWire is a Placement without its signature', () => {
    expectTypeOf<PlacementWire>().toEqualTypeOf<Omit<Placement, 'signature'>>()
  })

  it('ApiError has no optional field', () => {
    expectTypeOf<ApiError['error']['details']>().toEqualTypeOf<Record<string, unknown>>()
  })
})
