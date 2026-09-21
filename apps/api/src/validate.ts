import { ERROR_STATUS, apiError } from '@ordercraft/shared'
import type { Context } from 'hono'
import type { ZodError } from 'zod'

interface Outcome {
  success: boolean
  error?: ZodError
  target: string
}

/**
 * The hook every `zValidator` in the API is given. Without one the validator answers
 * with Zod's own object, which is a different shape from every other refusal; with
 * it, a body that fails its schema comes back in the one envelope, issue by issue.
 */
export function rejectInvalid(result: Outcome, c: Context): Response | undefined {
  if (result.success || result.error === undefined) return undefined

  const where = result.target === 'json' ? 'body' : result.target

  return c.json(
    apiError('INVALID_INPUT', `the ${where} did not match the schema`, {
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    }),
    ERROR_STATUS.INVALID_INPUT,
  )
}
