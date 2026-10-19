import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { hydrateSlotBundle, slotBundleSchema } from '@ordercraft/core'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('../slots/', import.meta.url))
const files = readdirSync(dir).filter((file) => file.endsWith('.json.gz'))

/**
 * The licence for the server to read a fixture without the schema: every fixture the
 * build ships parses, and reading it the fast way gives the very same bundle. A fixture
 * that would not parse, or a schema change the fast path does not follow, fails here.
 */
describe('every curated fixture', () => {
  it('is in the set', () => {
    expect(files.length).toBeGreaterThanOrEqual(53)
  })

  it.each(files)('%s reads the same without the schema as with it', (file) => {
    const json = JSON.parse(gunzipSync(readFileSync(`${dir}${file}`)).toString('utf8'))

    expect(hydrateSlotBundle(json)).toStrictEqual(slotBundleSchema.parse(json))
  })
})
