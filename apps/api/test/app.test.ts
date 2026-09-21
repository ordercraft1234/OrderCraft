import { apiErrorSchema } from '@ordercraft/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readEnv } from '../src/env.ts'
import { type Harness, WEB_ORIGIN, openHarness } from './harness.ts'

let h: Harness

beforeAll(async () => {
  h = await openHarness()
}, 60_000)

afterAll(() => h.close())

describe('the app', () => {
  it('answers /health', async () => {
    const response = await h.app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('answers an unknown route in the error envelope', async () => {
    const response = await h.api('/nothing')
    expect(response.status).toBe(404)
    expect(apiErrorSchema.parse(await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      details: { path: '/api/nothing' },
    })
  })

  it('lets the web origin in and nobody else', async () => {
    const ours = await h.api('/slots', { headers: { origin: WEB_ORIGIN } })
    expect(ours.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)

    const theirs = await h.api('/slots', { headers: { origin: 'https://example.com' } })
    expect(theirs.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('the environment', () => {
  const base = { DATABASE_URL: 'postgres://u:p@h:6543/db', WEB_ORIGIN: WEB_ORIGIN }

  it('reads what it needs and defaults the rest', () => {
    expect(readEnv(base)).toEqual({
      ...base,
      SOLANA_RPC_URL: undefined,
      PORT: 8787,
      SLOT_CACHE_DIR: '.cache/slots',
    })
  })

  it('treats an empty RPC URL as no RPC, the way .env.example ships it', () => {
    expect(readEnv({ ...base, SOLANA_RPC_URL: '' }).SOLANA_RPC_URL).toBeUndefined()
    expect(
      readEnv({ ...base, SOLANA_RPC_URL: 'https://rpc.example/?api-key=k' }).SOLANA_RPC_URL,
    ).toBe('https://rpc.example/?api-key=k')
  })

  it('names the variable that is missing', () => {
    expect(() => readEnv({ WEB_ORIGIN })).toThrow(/DATABASE_URL/)
    expect(() => readEnv({ ...base, PORT: 'eighty' })).toThrow(/PORT/)
  })
})
