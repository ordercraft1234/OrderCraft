import { z } from 'zod'

/** An optional URL: unset and empty both mean "off", because `.env.example` ships it empty. */
const optionalUrl = z
  .string()
  .default('')
  .transform((value) => (value === '' ? undefined : value))
  .pipe(z.string().url().optional())

/**
 * What the server reads from its environment, checked once at boot. A missing
 * `DATABASE_URL` fails here with the variable's name rather than later with a stack
 * trace from the driver. `SOLANA_RPC_URL` is the only door to live fetching (FR-023):
 * empty, and `/slots/fetch` answers `403 RPC_DISABLED`.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  SOLANA_RPC_URL: optionalUrl,
  PORT: z.coerce.number().int().positive().default(8787),
  /** Where live-fetched slots go, in the fixture format (FR-024). */
  SLOT_CACHE_DIR: z.string().min(1).default('.cache/slots'),
})

export type Env = z.infer<typeof envSchema>

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (result.success) return result.data

  const missing = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new Error(`environment is not usable:\n  ${missing.join('\n  ')}`)
}
