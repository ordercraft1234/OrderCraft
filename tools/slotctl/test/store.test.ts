import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { normalizeBlock } from '@ordercraft/core'
import { afterAll, describe, expect, it } from 'vitest'
import block from '../../../packages/core/test/fixtures/block-sample.json' with { type: 'json' }
import { readSlot, slotPath, writeSlot } from '../src/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'slotctl-'))
const bundle = normalizeBlock(441394400, block)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('slot store', () => {
  it('names a file after its slot', () => {
    expect(slotPath(dir, 441394400)).toBe(join(dir, '441394400.json.gz'))
  })

  it('writes gzip and reads back the same bundle', () => {
    const path = writeSlot(dir, bundle)

    expect(readFileSync(path).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
    expect(readSlot(path)).toEqual(bundle)
  })

  it('stores the bundle, not the raw RPC answer', () => {
    const text = gunzipSync(readFileSync(writeSlot(dir, bundle))).toString('utf8')

    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, slot: 441394400 })
    expect(text).not.toContain('preBalances')
  })

  it('refuses gzip that does not hold a slot bundle', () => {
    const path = join(dir, 'wrong-shape.json.gz')
    writeFileSync(path, gzipSync(Buffer.from(JSON.stringify({ nope: true }), 'utf8')))

    expect(() => readSlot(path)).toThrow()
  })

  it('refuses a file that is not gzip at all', () => {
    const path = join(dir, 'plain.json.gz')
    writeFileSync(path, 'not gzip')

    expect(() => readSlot(path)).toThrow()
  })
})
