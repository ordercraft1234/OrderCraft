import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBlock } from '@ordercraft/core'
import { fetchBlock } from './rpc.ts'
import { type Candidate, findCandidates } from './scan.ts'
import { readSlot, writeSlot } from './store.ts'

const CACHE_DIR = '.cache/slots'
const FIXTURE_DIR = 'packages/fixtures/slots'

const usage = `slotctl fetch <slot> [--fixture] [--out <dir>]
slotctl scan <dir> [--window <n>] [--random <k>] [--out <file>]

  fetch  Fetches one slot, normalises it and writes <slot>.json.gz.
         Default target is ${CACHE_DIR}; --fixture writes to ${FIXTURE_DIR}.
         Needs SOLANA_RPC_URL in the environment.

  scan   Reads every slot in <dir> and prints candidate triples for manual
         review. The filter is wider than the detector on purpose; --random
         also draws <k> slots that no filter chose, so recall can be measured
         against something the detector did not select.`

function flag(rest: string[], name: string): string | undefined {
  const at = rest.indexOf(name)
  return at === -1 ? undefined : rest[at + 1]
}

async function fetchCommand(slotArgument: string, rest: string[]): Promise<number> {
  const slot = Number(slotArgument)
  if (!Number.isSafeInteger(slot) || slot < 0) {
    process.stderr.write(`not a slot number: ${slotArgument}\n`)
    return 2
  }

  const url = process.env.SOLANA_RPC_URL
  if (url === undefined || url === '') {
    process.stderr.write(
      'SOLANA_RPC_URL is not set — live fetching is off, and the curated set in packages/fixtures is all that is available.\n',
    )
    return 1
  }

  const directory = flag(rest, '--out') ?? (rest.includes('--fixture') ? FIXTURE_DIR : CACHE_DIR)
  const bundle = normalizeBlock(slot, await fetchBlock(slot, { url }))
  const path = writeSlot(directory, bundle)

  process.stdout.write(`${path} — ${bundle.transactions.length} transactions\n`)
  return 0
}

function scanCommand(directory: string, rest: string[]): number {
  const files = readdirSync(directory).filter((name) => name.endsWith('.json.gz'))
  if (files.length === 0) {
    process.stderr.write(`no slots in ${directory}\n`)
    return 1
  }

  const windowArgument = flag(rest, '--window')
  const window = windowArgument === undefined ? undefined : Number(windowArgument)
  const randomCount = Number(flag(rest, '--random') ?? 0)

  const candidates: Candidate[] = []
  const scanned: number[] = []

  for (const file of files) {
    const bundle = readSlot(join(directory, file))
    scanned.push(bundle.slot)
    candidates.push(...findCandidates(bundle, window === undefined ? {} : { window }))
  }

  // Slots drawn without looking at the filter. Attacks the filter cannot see exist
  // only here, and without them recall is measured against our own imagination.
  const withoutCandidates = scanned.filter(
    (slot) => !candidates.some((candidate) => candidate.slot === slot),
  )
  const randomSlots = withoutCandidates.slice(0, randomCount)

  const shortlist = { scanned, candidates, randomSlots }
  const out = flag(rest, '--out')
  if (out === undefined) {
    process.stdout.write(
      `${scanned.length} slots, ${candidates.length} candidates, ${randomSlots.length} random slots\n`,
    )
  } else {
    writeFileSync(out, `${JSON.stringify(shortlist, null, 1)}\n`, 'utf8')
    process.stdout.write(`${out} — ${candidates.length} candidates from ${scanned.length} slots\n`)
  }

  return 0
}

async function main(argv: string[]): Promise<number> {
  const [command, target, ...rest] = argv

  if (command === 'fetch' && target !== undefined) return fetchCommand(target, rest)
  if (command === 'scan' && target !== undefined) return scanCommand(target, rest)

  process.stderr.write(`${usage}\n`)
  return 2
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
