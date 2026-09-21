import { getConnInfo } from '@hono/node-server/conninfo'
import { ERROR_STATUS, apiError } from '@ordercraft/shared'
import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  limit: number
  windowMs: number
  /** The clock, injectable so a test does not have to wait a minute. */
  now?: () => number
}

/**
 * A sliding window per client address, in memory. There is one API process on the
 * free tier and the window is a minute, so a map of timestamps is the whole store;
 * a restart forgets it, which costs nothing worse than ten more fetches.
 *
 * The address comes from `X-Forwarded-For` first — Render terminates TLS in front of
 * the process — and only then from the socket. A client cannot lower its own count
 * by spoofing the header: the proxy appends the real address, and the first entry is
 * the one furthest from us, which is the one it set. The consequence is that a
 * spoofed header shares a bucket with whoever the spoof names, never with nobody.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now
  const seen = new Map<string, number[]>()

  return async (c, next) => {
    const at = now()
    const key = clientAddress(c)
    const recent = (seen.get(key) ?? []).filter((stamp) => at - stamp < options.windowMs)

    if (recent.length >= options.limit) {
      const oldest = recent[0] ?? at
      const retryAfter = Math.ceil((oldest + options.windowMs - at) / 1000)

      seen.set(key, recent)
      c.header('retry-after', String(retryAfter))
      return c.json(
        apiError('RATE_LIMITED', `at most ${options.limit} fetches a minute from one address`, {
          retryAfterSeconds: retryAfter,
        }),
        ERROR_STATUS.RATE_LIMITED,
      )
    }

    recent.push(at)
    seen.set(key, recent)

    // Addresses that have gone quiet are dropped, so the map holds only the last
    // minute of clients rather than everyone who ever called.
    if (seen.size > 1000) {
      for (const [other, stamps] of seen) {
        if (stamps.every((stamp) => at - stamp >= options.windowMs)) seen.delete(other)
      }
    }

    await next()
  }
}

function clientAddress(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded !== undefined) {
    const first = forwarded.split(',')[0]?.trim()
    if (first !== undefined && first.length > 0) return first
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    // Not running under the Node server — `app.request` in a test — and no header.
    return 'unknown'
  }
}
