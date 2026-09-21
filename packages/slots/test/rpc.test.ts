import { describe, expect, it } from 'vitest'
import { RpcRefused, SLOT_MISSING_CODES, fetchBlock } from '../src/rpc.ts'

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })

describe('fetchBlock', () => {
  it('asks for the full block with lookup tables resolved', async () => {
    let seen: { url: string; body: unknown } | null = null
    const stub: typeof fetch = async (input, init) => {
      seen = { url: String(input), body: JSON.parse(String(init?.body)) }
      return ok({ transactions: [] })
    }

    await fetchBlock(441394400, { url: 'https://rpc.example/x', fetchImpl: stub })

    expect(seen).toMatchObject({
      url: 'https://rpc.example/x',
      body: {
        method: 'getBlock',
        params: [
          441394400,
          {
            encoding: 'json',
            transactionDetails: 'full',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
      },
    })
  })

  it('returns the result untouched — validation belongs to the normaliser', async () => {
    const block = { blockTime: 1, transactions: [{ anything: true }] }
    const stub: typeof fetch = async () => ok(block)

    expect(await fetchBlock(1, { url: 'https://rpc.example', fetchImpl: stub })).toEqual(block)
  })

  it('reports a skipped slot as such, not as a transport failure', async () => {
    const stub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32009, message: 'Slot 12 was skipped, or missing in long-term storage' },
        }),
        { status: 200 },
      )

    const refusal = await fetchBlock(12, { url: 'https://rpc.example', fetchImpl: stub }).catch(
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(RpcRefused)
    expect(refusal).toMatchObject({ slot: 12, code: -32009 })
    expect(String(refusal)).toMatch(/skipped/)
    expect(SLOT_MISSING_CODES.has((refusal as RpcRefused).code)).toBe(true)
  })

  it('reports an HTTP failure with its status', async () => {
    const stub: typeof fetch = async () => new Response('rate limited', { status: 429 })

    await expect(fetchBlock(1, { url: 'https://rpc.example', fetchImpl: stub })).rejects.toThrow(
      /429/,
    )
  })

  it('refuses a response that is not a JSON-RPC envelope', async () => {
    const stub: typeof fetch = async () => new Response('{"unexpected":true}', { status: 200 })

    await expect(fetchBlock(1, { url: 'https://rpc.example', fetchImpl: stub })).rejects.toThrow(
      /envelope/,
    )
  })
})
