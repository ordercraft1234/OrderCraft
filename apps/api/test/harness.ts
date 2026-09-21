import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import {
  type NormalizedTransaction,
  POLICY_SCHEMA_VERSION,
  type Policy,
  SLOT_SCHEMA_VERSION,
  type SlotBundle,
} from '@ordercraft/core'
import { type Db, schema } from '@ordercraft/db'
import { migrationSql } from '@ordercraft/db/migrations'
import { writeSlot } from '@ordercraft/slots'
import type { RpcOptions } from '@ordercraft/slots'
import { drizzle } from 'drizzle-orm/pglite'
import { type App, createApp } from '../src/app.ts'
import { SlotFetcher } from '../src/services/fetch.ts'
import { SlotStore } from '../src/services/slots.ts'

export const WEB_ORIGIN = 'http://localhost:5173'

/** A slot with one sandwich in it, in the curated set, with labels. */
export const FIXTURE_SLOT = 441394400
/** A slot in the curated set that nobody has labelled. */
export const PLAIN_SLOT = 441394401
/** A slot nobody has loaded. */
export const UNKNOWN_SLOT = 441394402

export const POOL = 'CbjY8Wohs2EnLLjSNMPkFrn9iaPvVJJtAdJiWRYeeN2x'
export const AMM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const ATTACKER = '7QmXo9tXo94BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
export const VICTIM = 'Ka91rW7dWD4BpPDA5Q18TCXSvtwxGnXp47GVr7Mnh2Ey'
export const MINT = '4QXnu6ycbvJRQ1eyhF2egtwURhChYHQGpjr5P9fgpump'
export const QUOTE = 'So11111111111111111111111111111111111111112'

/**
 * Holds the attacker back past the victim: on six transactions the front leg arrives
 * at 66 ms and the victim at 133 ms, so a 100 ms bump puts the victim first and leaves
 * nobody between the legs — broken by order, with both legs still in the block.
 */
export const POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'bump the attacker',
  steps: [{ kind: 'speedBump', delayMs: 100, appliesTo: { match: 'signer', signers: [ATTACKER] } }],
}

/** The kernel refuses this one: nothing would ever be included. */
export const UNRUNNABLE_POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  name: 'deny all',
  steps: [{ kind: 'allowDeny', rules: [{ effect: 'deny', match: { match: 'all' } }] }],
}

export interface HarnessOptions {
  /** Turns `/slots/fetch` on, against whatever `fetchImpl` answers. */
  rpc?: RpcOptions
  now?: () => number
}

export interface Harness {
  app: App
  db: Db
  store: SlotStore
  dirs: { fixtures: string; labels: string; cache: string }
  /** `app.request` against `/api`, with JSON in and the parsed body out. */
  api(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>
  close(): Promise<void>
}

/**
 * The API over PGlite and a temporary directory laid out like the repository: two
 * fixture slots, one label file, an empty cache. `syncFixtures` runs the way it does
 * at boot, so the tests start where the server starts.
 */
export async function openHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'ordercraft-api-'))
  const dirs = {
    fixtures: join(root, 'slots'),
    labels: join(root, 'labels'),
    cache: join(root, 'cache'),
  }

  writeSlot(dirs.fixtures, sandwichSlot(FIXTURE_SLOT))
  writeSlot(dirs.fixtures, quietSlot(PLAIN_SLOT))
  mkdirSync(dirs.labels, { recursive: true })
  writeFileSync(join(dirs.labels, `${FIXTURE_SLOT}.json`), '{}')

  const client = await PGlite.create()
  await client.exec(migrationSql())
  const db: Db = drizzle(client, { schema })

  const store = new SlotStore(dirs)
  await store.syncFixtures(db)

  const app = createApp({
    db,
    store,
    webOrigin: WEB_ORIGIN,
    fetcher: options.rpc === undefined ? undefined : new SlotFetcher(options.rpc),
    now: options.now,
    log: false,
  })

  return {
    app,
    db,
    store,
    dirs,
    api(path, init = {}) {
      const { json, ...rest } = init
      const headers = new Headers(rest.headers)
      if (json !== undefined) headers.set('content-type', 'application/json')

      const request: RequestInit = { ...rest, headers }
      if (json !== undefined) request.body = JSON.stringify(json)

      return Promise.resolve(app.request(`/api${path}`, request))
    },
    async close() {
      await client.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const DIGIT_LETTERS = 'abcdefghij'

function signatureFor(slot: number, index: number): string {
  const body = [...`${slot}${index}`].map((digit) => DIGIT_LETTERS[Number(digit)] ?? 'a').join('')
  return `sig${body}`.padEnd(44, 'x')
}

function tx(
  slot: number,
  index: number,
  overrides: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  return {
    index,
    signature: signatureFor(slot, index),
    signers: [ATTACKER],
    programs: [AMM],
    accounts: [ATTACKER, POOL, AMM],
    fee: 5000n,
    failed: false,
    computeUnits: 150000n,
    lamportDelta: {},
    tokenDelta: [],
    ...overrides,
  }
}

/** The attacker's leg: `quote` its wallet moved, `token` the pool moved the other way. */
function leg(slot: number, index: number, quote: bigint, token: bigint): NormalizedTransaction {
  return tx(slot, index, {
    tokenDelta: [
      { owner: ATTACKER, mint: QUOTE, amount: quote },
      { owner: POOL, mint: QUOTE, amount: -quote },
      { owner: POOL, mint: MINT, amount: token },
    ],
  })
}

/** Somebody buying the token off the pool, both sides recorded. */
function victim(slot: number, index: number): NormalizedTransaction {
  return tx(slot, index, {
    signers: [VICTIM],
    accounts: [VICTIM, POOL],
    tokenDelta: [
      { owner: VICTIM, mint: QUOTE, amount: -300n },
      { owner: POOL, mint: QUOTE, amount: 300n },
      { owner: VICTIM, mint: MINT, amount: 600n },
      { owner: POOL, mint: MINT, amount: -600n },
    ],
  })
}

/** Open at 5 token per quote, close at 4.55: one sandwich at positions 1–3 of 6. */
export function sandwichSlot(slot: number): SlotBundle {
  return {
    schemaVersion: SLOT_SCHEMA_VERSION,
    slot,
    blockTime: 1787574541,
    transactions: [
      tx(slot, 0, { signers: [VICTIM], accounts: [VICTIM, AMM] }),
      leg(slot, 1, -1000n, -5000n),
      victim(slot, 2),
      leg(slot, 3, 1100n, 5000n),
      tx(slot, 4, { signers: [VICTIM], accounts: [VICTIM, AMM] }),
      tx(slot, 5, { signers: [VICTIM], accounts: [VICTIM, AMM] }),
    ],
  }
}

export function quietSlot(slot: number): SlotBundle {
  return {
    schemaVersion: SLOT_SCHEMA_VERSION,
    slot,
    blockTime: 1787574542,
    transactions: [0, 1, 2].map((index) =>
      tx(slot, index, { signers: [VICTIM], accounts: [VICTIM, AMM] }),
    ),
  }
}
