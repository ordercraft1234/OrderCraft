import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import {
  type SerializedSlotBundle,
  type SlotBundle,
  hydrateSlotBundle,
  serializeSlotBundle,
  slotBundleSchema,
} from '@ordercraft/core'

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
  writeFileSync(path, gzipSync(slotBytes(bundle)))
  return path
}

/**
 * SHA-256 of the bundle as it is written, before gzip: two machines that normalised the
 * same block get the same hash, and a re-fetched block that came back different from
 * the node — it happens on a fork — shows up as a different one.
 */
export function slotContentHash(bundle: SlotBundle): string {
  return bytesToHex(sha256(slotBytes(bundle)))
}

function slotBytes(bundle: SlotBundle): Uint8Array {
  return Buffer.from(JSON.stringify(serializeSlotBundle(bundle)), 'utf8')
}

export function readSlot(path: string): SlotBundle {
  return slotBundleSchema.parse(readJson(path))
}

/**
 * A curated fixture, without the schema: the gate parses every fixture with it and
 * checks that this gives the same bundle (`packages/fixtures/test/hydrate.test.ts`).
 * Never for a file that came from outside the repository.
 */
export function readTrustedSlot(path: string): SlotBundle {
  return hydrateSlotBundle(readJson(path) as SerializedSlotBundle)
}

function readJson(path: string): unknown {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'))
}
