import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { SlotBundle } from '@ordercraft/core'
import { type Db, slots } from '@ordercraft/db'
import type { SlotSource, SlotSummary } from '@ordercraft/shared'
import { readSlot, slotContentHash, slotPath, writeSlot } from '@ordercraft/slots'
import { eq } from 'drizzle-orm'
import { notFound } from '../errors.ts'

export interface SlotDirs {
  /** The curated set: `packages/fixtures/slots/<slot>.json.gz`. */
  fixtures: string
  /** Hand-checked labels beside it: `packages/fixtures/labels/<slot>.json`. */
  labels: string
  /** Live-fetched blocks, outside the repository (FR-024). */
  cache: string
}

/** How many parsed bundles stay in memory. The demo slot is asked for again and again. */
const PARSED_KEEP = 8

/**
 * Blocks live in files; the database holds one row per file saying what it is. This
 * class is the seam between the two: the row says which directory, the directory holds
 * the bytes, and nothing else in the API touches either directly.
 */
export class SlotStore {
  readonly #dirs: SlotDirs
  readonly #parsed = new Map<number, SlotBundle>()

  constructor(dirs: SlotDirs) {
    this.#dirs = dirs
  }

  /** The curated set as the repository lays it out, found through the package. */
  static repositoryDirs(cache: string): SlotDirs {
    const fixtures = dirname(
      dirname(createRequire(import.meta.url).resolve('@ordercraft/fixtures')),
    )

    return { fixtures: join(fixtures, 'slots'), labels: join(fixtures, 'labels'), cache }
  }

  /**
   * Makes sure every fixture file has its row. Runs at boot; a file already indexed is
   * not read again, so after the first start this is one directory listing and one
   * query. Fixtures are the repository's, which is why nothing here ever deletes.
   */
  async syncFixtures(db: Db): Promise<number> {
    const known = new Set((await db.select({ slot: slots.slot }).from(slots)).map((r) => r.slot))
    let added = 0

    for (const slot of listSlots(this.#dirs.fixtures)) {
      if (known.has(slot)) continue

      const bundle = readSlot(slotPath(this.#dirs.fixtures, slot))
      await db
        .insert(slots)
        .values({
          slot,
          source: 'fixture',
          txCount: bundle.transactions.length,
          contentHash: slotContentHash(bundle),
        })
        .onConflictDoNothing()
      added += 1
    }

    return added
  }

  async list(db: Db, source: SlotSource | 'all'): Promise<SlotSummary[]> {
    const rows = await db
      .select()
      .from(slots)
      .where(source === 'all' ? undefined : eq(slots.source, source))
      .orderBy(slots.slot)
    const labelled = new Set(listLabels(this.#dirs.labels))

    return rows.map((row) => ({
      slot: row.slot,
      source: row.source,
      txCount: row.txCount,
      hasLabels: labelled.has(row.slot),
    }))
  }

  /** The row, or `NOT_FOUND` — a slot nobody has loaded is not an error of ours. */
  async summary(db: Db, slot: number): Promise<SlotSummary> {
    const row = await db.query.slots.findFirst({ where: eq(slots.slot, slot) })
    if (row === undefined) {
      throw notFound('slot', { slot, hint: 'load it with POST /slots/fetch' })
    }

    return {
      slot: row.slot,
      source: row.source,
      txCount: row.txCount,
      hasLabels: existsSync(join(this.#dirs.labels, `${slot}.json`)),
    }
  }

  /**
   * The file as it is on disk — gzip — for `GET /slots/:slot`, which hands it over
   * with `Content-Encoding: gzip` and lets the browser unpack it.
   */
  async bytes(db: Db, slot: number): Promise<Buffer> {
    const { source } = await this.summary(db, slot)
    const path = slotPath(this.#dirFor(source), slot)
    if (!existsSync(path)) {
      // The row promised a file that is not there: not the caller's mistake, ours.
      throw new Error(`slot ${slot} is indexed as ${source} but ${path} is missing`)
    }

    return readFileSync(path)
  }

  /** The bundle, parsed and checked, for a run. */
  async read(db: Db, slot: number): Promise<SlotBundle> {
    const kept = this.#parsed.get(slot)
    if (kept !== undefined) return kept

    const { source } = await this.summary(db, slot)
    const bundle = readSlot(slotPath(this.#dirFor(source), slot))
    this.#remember(bundle)

    return bundle
  }

  /** Writes a live-fetched block to the cache and indexes it (FR-024). */
  async put(db: Db, bundle: SlotBundle): Promise<SlotSummary> {
    writeSlot(this.#dirs.cache, bundle)
    await db
      .insert(slots)
      .values({
        slot: bundle.slot,
        source: 'rpc',
        txCount: bundle.transactions.length,
        contentHash: slotContentHash(bundle),
      })
      .onConflictDoNothing()
    this.#remember(bundle)

    return this.summary(db, bundle.slot)
  }

  #dirFor(source: SlotSource): string {
    return source === 'fixture' ? this.#dirs.fixtures : this.#dirs.cache
  }

  #remember(bundle: SlotBundle): void {
    if (this.#parsed.size >= PARSED_KEEP) {
      const oldest = this.#parsed.keys().next().value
      if (oldest !== undefined) this.#parsed.delete(oldest)
    }
    this.#parsed.set(bundle.slot, bundle)
  }
}

function listSlots(directory: string): number[] {
  return listNumbered(directory, '.json.gz')
}

function listLabels(directory: string): number[] {
  return listNumbered(directory, '.json')
}

/** `<slot><suffix>` files only; anything else in the directory is not a slot. */
function listNumbered(directory: string, suffix: string): number[] {
  if (!existsSync(directory)) return []

  return readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.slice(0, -suffix.length))
    .filter((stem) => /^[1-9][0-9]*$/.test(stem))
    .map(Number)
    .sort((left, right) => left - right)
}
