import { normalizeBlock } from '@ordercraft/core'
import type { Db } from '@ordercraft/db'
import type { FetchSlotResponse } from '@ordercraft/shared'
import { type RpcOptions, RpcRefused, SLOT_MISSING_CODES, fetchBlock } from '@ordercraft/slots'
import { ZodError } from 'zod'
import { HttpError, notFound } from '../errors.ts'
import type { SlotStore } from './slots.ts'

/**
 * `POST /slots/fetch` (FR-023, FR-024). A slot already on disk is answered from the
 * index without touching the network; anything else is one `getBlock`, normalised,
 * written to the cache and indexed — after which it is a slot like any other.
 *
 * Two requests for the same new slot at once share one fetch rather than spending
 * two RPC calls on one block.
 */
export class SlotFetcher {
  readonly #rpc: RpcOptions
  readonly #inFlight = new Map<number, Promise<FetchSlotResponse>>()

  constructor(rpc: RpcOptions) {
    this.#rpc = rpc
  }

  async fetch(db: Db, store: SlotStore, slot: number): Promise<FetchSlotResponse> {
    const known = await store.summary(db, slot).catch((error: unknown) => {
      if (error instanceof HttpError && error.code === 'NOT_FOUND') return undefined
      throw error
    })
    if (known !== undefined) return { slot, txCount: known.txCount, cached: true }

    const running = this.#inFlight.get(slot)
    if (running !== undefined) return running

    const work = this.#fetchInto(db, store, slot).finally(() => this.#inFlight.delete(slot))
    this.#inFlight.set(slot, work)

    return work
  }

  async #fetchInto(db: Db, store: SlotStore, slot: number): Promise<FetchSlotResponse> {
    const raw = await fetchBlock(slot, this.#rpc).catch((error: unknown) => {
      throw asHttpError(slot, error, this.#rpc.url)
    })

    let bundle: ReturnType<typeof normalizeBlock>
    try {
      bundle = normalizeBlock(slot, raw)
    } catch (error) {
      // The node answered with something the normaliser does not recognise. That is
      // the node's shape or ours having moved, not the client's doing.
      if (!(error instanceof ZodError)) throw error
      throw new HttpError(
        'RPC_FAILED',
        `slot ${slot} came back in a shape this server cannot read`,
        {
          slot,
          issues: error.issues
            .slice(0, 5)
            .map((issue) => ({ path: issue.path, message: issue.message })),
        },
      )
    }

    const summary = await store.put(db, bundle)

    return { slot, txCount: summary.txCount, cached: false }
  }
}

/**
 * The node's refusals, sorted: a slot that was skipped is `NOT_FOUND`, because there
 * is nothing to fetch and asking again will not help; everything else is the upstream
 * failing us, `RPC_FAILED`. The message never carries the URL — it holds the key.
 */
function asHttpError(slot: number, error: unknown, url: string): HttpError {
  if (error instanceof RpcRefused && SLOT_MISSING_CODES.has(error.code)) {
    return notFound('slot', {
      slot,
      rpcCode: error.code,
      reason: 'the node has no block at this slot',
    })
  }

  const message = (error instanceof Error ? error.message : String(error)).replaceAll(url, '<rpc>')
  return new HttpError('RPC_FAILED', message, { slot })
}
