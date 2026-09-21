import { ERROR_STATUS, type ErrorCode, apiError } from '@ordercraft/shared'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * A refusal the service has decided on. Thrown from services, turned into the one
 * error envelope by `handleError` — so a route never builds a response for a failure
 * itself, and every failure has a code the client can switch on.
 */
export class HttpError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.details = details
  }
}

export function notFound(what: string, details: Record<string, unknown>): HttpError {
  return new HttpError('NOT_FOUND', `${what} not found`, details)
}

/**
 * `app.onError`. Anything that is not an `HttpError` is a bug, and a bug's message is
 * for the log, not the client: it may quote the query, the file path or the RPC URL.
 */
export function handleError(error: Error, c: Context): Response {
  if (error instanceof HttpError) {
    return c.json(apiError(error.code, error.message, error.details), ERROR_STATUS[error.code])
  }

  // Hono's own refusals — the body limit, above all — keep their status and take the
  // envelope, so a client sees one shape whoever said no.
  if (error instanceof HTTPException) {
    return c.json(apiError('INVALID_INPUT', error.message || 'request refused'), error.status)
  }

  console.error(error)

  return c.json(apiError('INTERNAL', 'something went wrong on the server'), ERROR_STATUS.INTERNAL)
}
