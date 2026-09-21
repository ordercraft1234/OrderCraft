import { z } from 'zod'

/**
 * Every way the API says no, with the status each one travels under.
 *
 * - `INVALID_INPUT` — the body, query or path failed its schema; `details` carries the
 *   issues.
 * - `NOT_FOUND` — the policy, version, slot, run or batch named does not exist.
 * - `RPC_DISABLED` — `/slots/fetch` was called while `SOLANA_RPC_URL` is unset (FR-023).
 * - `RATE_LIMITED` — more than the allowed fetches per minute from one address.
 * - `RPC_FAILED` — the upstream RPC answered with an error or something the schema
 *   rejected; the slot is not cached.
 * - `INTERNAL` — anything the server did not expect. The message is generic on purpose.
 */
export const ERROR_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  RPC_DISABLED: 403,
  RATE_LIMITED: 429,
  RPC_FAILED: 502,
  INTERNAL: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export const errorCode = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]])

/** The one shape every non-2xx answer has. `details` is always present, even if empty. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCode,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>

/** Builds the envelope. Kept here so the server and the tests spell it identically. */
export function apiError(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return { error: { code, message, details } }
}
