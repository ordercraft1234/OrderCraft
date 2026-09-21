import { zValidator } from '@hono/zod-validator'
import type { Db } from '@ordercraft/db'
import {
  createPolicyRequestSchema,
  policyHashParamSchema,
  policyIdParamSchema,
} from '@ordercraft/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getPolicy, getVersion, savePolicy } from '../services/policies.ts'
import { rejectInvalid } from '../validate.ts'

/** The plan's ceiling on a policy body. The schema bounds the steps; this bounds the bytes. */
const POLICY_BODY_LIMIT = 64 * 1024

export function policyRoutes(db: Db) {
  return new Hono()
    .post(
      '/',
      bodyLimit({ maxSize: POLICY_BODY_LIMIT }),
      zValidator('json', createPolicyRequestSchema, rejectInvalid),
      async (c) => {
        const response = await savePolicy(db, c.req.valid('json'))
        return c.json(response, response.created ? 201 : 200)
      },
    )
    .get('/hash/:hash', zValidator('param', policyHashParamSchema, rejectInvalid), async (c) => {
      return c.json(await getVersion(db, c.req.valid('param').hash))
    })
    .get('/:id', zValidator('param', policyIdParamSchema, rejectInvalid), async (c) => {
      return c.json(await getPolicy(db, c.req.valid('param').id))
    })
}
