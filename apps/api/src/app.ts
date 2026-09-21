import type { Db } from '@ordercraft/db'
import { ERROR_STATUS, apiError } from '@ordercraft/shared'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { handleError } from './errors.ts'
import { policyRoutes } from './routes/policies.ts'
import { runRoutes } from './routes/runs.ts'
import { slotRoutes } from './routes/slots.ts'
import type { SlotFetcher } from './services/fetch.ts'
import type { SlotStore } from './services/slots.ts'

export interface AppOptions {
  db: Db
  store: SlotStore
  /** The one origin allowed to call from a browser — the web app's. */
  webOrigin: string
  /** Live fetching; absent while the server has no RPC address (FR-023). */
  fetcher?: SlotFetcher | undefined
  /** The rate limiter's clock, for tests. */
  now?: (() => number) | undefined
  /** Off in tests: the request log is noise there. */
  log?: boolean
}

/**
 * The API as a value, with no port and no environment: `server.ts` gives it both,
 * the tests give it a PGlite database and a temporary directory of slots. Everything
 * is mounted under `/api` so that the same host could serve the web app beside it.
 */
export function createApp(options: AppOptions) {
  const app = new Hono()

  if (options.log !== false) app.use(logger())
  app.use('/api/*', cors({ origin: options.webOrigin }))

  app.get('/health', (c) => c.json({ ok: true }))

  const api = new Hono()
    .route('/policies', policyRoutes(options.db))
    .route(
      '/slots',
      slotRoutes(options.db, options.store, { fetcher: options.fetcher, now: options.now }),
    )
    .route('/runs', runRoutes(options.db, options.store))

  app.route('/api', api)

  app.notFound((c) =>
    c.json(apiError('NOT_FOUND', 'no such route', { path: c.req.path }), ERROR_STATUS.NOT_FOUND),
  )
  app.onError(handleError)

  return app
}

export type App = ReturnType<typeof createApp>
