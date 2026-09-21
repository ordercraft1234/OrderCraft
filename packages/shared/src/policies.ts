import { policySchema } from '@ordercraft/core'
import { z } from 'zod'
import { policyHashHex, presetId, timestamp, uuid } from './scalars.ts'

/**
 * `POST /policies` (FR-005).
 *
 * A policy is a shelf of versions; a version is a body addressed by its hash. The body
 * carries its own `name` and that name is part of the hash, so there is no second name
 * to send: the shelf takes the name of the version that opened it. `policyId` puts a
 * new version on an existing shelf; without it the server opens a new one. A body whose
 * hash is already stored is returned as it is, whatever shelf it sits on — the address
 * is the content, and one content has one address.
 *
 * The 64 KB ceiling on the body is enforced by the server before parsing, not here:
 * the schema already bounds the steps and the addresses in each, and a limit expressed
 * in bytes belongs to the layer that sees bytes.
 */
export const createPolicyRequestSchema = z.object({
  body: policySchema,
  policyId: uuid.optional(),
  presetId: presetId.optional(),
})

export type CreatePolicyRequest = z.infer<typeof createPolicyRequestSchema>

export const createPolicyResponseSchema = z.object({
  policyId: uuid,
  hash: policyHashHex,
  /** `false` when the hash was already stored and nothing was written. */
  created: z.boolean(),
})

export type CreatePolicyResponse = z.infer<typeof createPolicyResponseSchema>

export const policyVersionSummarySchema = z.object({
  hash: policyHashHex,
  presetId: presetId.nullable(),
  createdAt: timestamp,
})

/** `GET /policies/:id` — the shelf with its versions, newest first. */
export const policyViewSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  createdAt: timestamp,
  versions: z.array(policyVersionSummarySchema).min(1),
})

export type PolicyView = z.infer<typeof policyViewSchema>

/** `GET /policies/hash/:hash` — one version, with the shelf it belongs to. */
export const policyVersionViewSchema = z.object({
  hash: policyHashHex,
  policyId: uuid,
  body: policySchema,
  presetId: presetId.nullable(),
  createdAt: timestamp,
})

export type PolicyVersionView = z.infer<typeof policyVersionViewSchema>

export const policyIdParamSchema = z.object({ id: uuid })
export const policyHashParamSchema = z.object({ hash: policyHashHex })
