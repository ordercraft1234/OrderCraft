import { SLOT_DURATION_MS } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'
import { msPerPosition } from '../src/components/TimeModelNote.tsx'

describe('msPerPosition', () => {
  it('divides the slot by the transactions the block held', () => {
    expect(msPerPosition(1422)).toBe('0.28')
    expect(msPerPosition(SLOT_DURATION_MS)).toBe('1.00')
  })

  /**
   * A block with no transactions cannot happen — every slot carries at least a vote —
   * but the note renders before anything checks that, and a division here would put
   * `Infinity ms` on screen.
   */
  it('does not divide by an empty block', () => {
    expect(msPerPosition(0)).toBe('0.00')
  })
})
