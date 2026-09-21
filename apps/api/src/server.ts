import { serve } from '@hono/node-server'
import { createDb } from '@ordercraft/db'
import { createApp } from './app.ts'
import { readEnv } from './env.ts'
import { SlotStore } from './services/slots.ts'

/**
 * The process. Reads the environment, opens the database, indexes the curated slots,
 * listens. Migrations are not run here — `pnpm --filter @ordercraft/db db:migrate`
 * does that, through the session pooler, before a deploy goes live.
 */
const env = readEnv()
const db = createDb(env.DATABASE_URL)
const store = new SlotStore(SlotStore.repositoryDirs(env.SLOT_CACHE_DIR))

const indexed = await store.syncFixtures(db)
console.log(`slots: ${indexed} fixture${indexed === 1 ? '' : 's'} newly indexed`)

const app = createApp({ db, store, webOrigin: env.WEB_ORIGIN })

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api: listening on http://localhost:${info.port}`)
  console.log(`rpc: ${env.SOLANA_RPC_URL === undefined ? 'disabled' : 'enabled'}`)
})
