import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { type SlotBundle, serializeSlotBundle, slotBundleSchema } from '@ordercraft/core'

export function slotPath(directory: string, slot: number): string {
  return join(directory, `${slot}.json.gz`)
}

/**
 * Slots are kept as normalised bundles rather than raw RPC answers: a raw block runs
 * to megabytes, and the curated set has to live inside a repository. The cost is that
 * a field the bundle drops can only be recovered by fetching the slot again.
 */
export function writeSlot(directory: string, bundle: SlotBundle): string {
  const path = slotPath(directory, bundle.slot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(serializeSlotBundle(bundle)), 'utf8')))
  return path
}

export function readSlot(path: string): SlotBundle {
  return slotBundleSchema.parse(JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')))
}
