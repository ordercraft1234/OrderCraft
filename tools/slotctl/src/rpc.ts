import { z } from 'zod'

// `result` is deliberately absent from the schema: z.unknown() also accepts a
// missing key, so a schema branch for it would match an error envelope too. Presence
// of the key is checked against the parsed JSON instead.
const envelopeSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

export interface RpcOptions {
  url: string
  fetchImpl?: typeof fetch
}

/**
 * One `getBlock` call. The result is handed back untouched: shape belongs to
 * `normalizeBlock`, which owns the only description of what a block must contain.
 */
export async function fetchBlock(slot: number, options: RpcOptions): Promise<unknown> {
  const call = options.fetchImpl ?? fetch

  const response = await call(options.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBlock',
      params: [
        slot,
        {
          encoding: 'json',
          transactionDetails: 'full',
          rewards: false,
          // Without this the node refuses every versioned transaction in the block,
          // and versioned transactions are exactly the ones that carry lookup tables.
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`getBlock ${slot} failed: HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  const envelope = envelopeSchema.safeParse(payload)
  if (!envelope.success || typeof payload !== 'object' || payload === null) {
    throw new Error(`getBlock ${slot} returned something that is not a JSON-RPC envelope`)
  }

  if (envelope.data.error !== undefined) {
    const { code, message } = envelope.data.error
    throw new Error(`getBlock ${slot} refused: ${message} (code ${code})`)
  }

  if (!('result' in payload)) {
    throw new Error(`getBlock ${slot} returned an envelope with neither result nor error`)
  }

  return (payload as { result: unknown }).result
}
