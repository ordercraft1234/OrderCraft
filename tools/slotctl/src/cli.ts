import { normalizeBlock } from '@ordercraft/core'
import { fetchBlock } from './rpc.ts'
import { writeSlot } from './store.ts'

const CACHE_DIR = '.cache/slots'
const FIXTURE_DIR = 'packages/fixtures/slots'

const usage = `slotctl fetch <slot> [--fixture] [--out <dir>]

  Fetches one slot, normalises it and writes <slot>.json.gz.
  Default target is ${CACHE_DIR}; --fixture writes to ${FIXTURE_DIR} instead.
  Needs SOLANA_RPC_URL in the environment.`

async function main(argv: string[]): Promise<number> {
  const [command, slotArgument, ...rest] = argv

  if (command !== 'fetch' || slotArgument === undefined) {
    process.stderr.write(`${usage}\n`)
    return 2
  }

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

  const outFlag = rest.indexOf('--out')
  const directory =
    outFlag === -1
      ? rest.includes('--fixture')
        ? FIXTURE_DIR
        : CACHE_DIR
      : (rest[outFlag + 1] ?? CACHE_DIR)

  const bundle = normalizeBlock(slot, await fetchBlock(slot, { url }))
  const path = writeSlot(directory, bundle)

  process.stdout.write(`${path} — ${bundle.transactions.length} transactions\n`)
  return 0
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
