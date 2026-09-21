import { policyHash, validatePolicy } from '@ordercraft/core'
import { type Db, policies, policyVersions } from '@ordercraft/db'
import type {
  CreatePolicyRequest,
  CreatePolicyResponse,
  PolicyVersionView,
  PolicyView,
} from '@ordercraft/shared'
import { TransactionRollbackError, desc, eq } from 'drizzle-orm'
import { HttpError, notFound } from '../errors.ts'

/**
 * Saves a version (FR-005). The hash is computed here, never trusted from the client,
 * and a body that hashes to a stored version returns that version whatever shelf it is
 * on: one content, one address.
 *
 * A body the kernel would refuse to run is refused here too. The schema has already
 * passed, so this is about `validatePolicy` — a policy that denies everything, say —
 * and saving it would mint a link to a run that can never happen.
 */
export async function savePolicy(
  db: Db,
  request: CreatePolicyRequest,
): Promise<CreatePolicyResponse> {
  const validation = validatePolicy(request.body)
  if (!validation.runnable) {
    throw new HttpError('INVALID_INPUT', 'the policy cannot be run as written', {
      issues: validation.issues.filter((issue) => issue.severity === 'error'),
    })
  }

  const hash = policyHash(request.body)
  const existing = await db.query.policyVersions.findFirst({
    where: eq(policyVersions.hash, hash),
  })
  if (existing !== undefined) {
    return { policyId: existing.policyId, hash, created: false }
  }

  if (request.policyId !== undefined) {
    const shelf = await db.query.policies.findFirst({ where: eq(policies.id, request.policyId) })
    if (shelf === undefined) throw notFound('policy', { policyId: request.policyId })
  }

  // One transaction, so that a shelf opened for a version that loses the race to
  // another request is rolled back with it rather than left empty.
  try {
    return await db.transaction(async (tx) => {
      const policyId = request.policyId ?? (await openShelf(tx, request.body.name))
      const inserted = await tx
        .insert(policyVersions)
        .values({
          hash,
          policyId,
          schemaVersion: request.body.schemaVersion,
          body: request.body,
          presetId: request.presetId ?? null,
        })
        .onConflictDoNothing()
        .returning({ policyId: policyVersions.policyId })
      if (inserted.length === 0) tx.rollback()

      return { policyId, hash, created: true }
    })
  } catch (error) {
    // `rollback()` unwinds by throwing; what remains is to answer with the version
    // that got there first.
    if (!(error instanceof TransactionRollbackError)) throw error

    const winner = await db.query.policyVersions.findFirst({
      where: eq(policyVersions.hash, hash),
    })
    if (winner === undefined) throw error

    return { policyId: winner.policyId, hash, created: false }
  }
}

export async function getPolicy(db: Db, id: string): Promise<PolicyView> {
  const shelf = await db.query.policies.findFirst({ where: eq(policies.id, id) })
  if (shelf === undefined) throw notFound('policy', { policyId: id })

  const versions = await db
    .select({
      hash: policyVersions.hash,
      presetId: policyVersions.presetId,
      createdAt: policyVersions.createdAt,
    })
    .from(policyVersions)
    .where(eq(policyVersions.policyId, id))
    .orderBy(desc(policyVersions.createdAt), desc(policyVersions.hash))

  return {
    id: shelf.id,
    name: shelf.name,
    createdAt: shelf.createdAt.toISOString(),
    versions: versions.map((version) => ({
      hash: version.hash,
      presetId: version.presetId,
      createdAt: version.createdAt.toISOString(),
    })),
  }
}

export async function getVersion(db: Db, hash: string): Promise<PolicyVersionView> {
  const version = await db.query.policyVersions.findFirst({
    where: eq(policyVersions.hash, hash),
  })
  if (version === undefined) throw notFound('policy version', { hash })

  return {
    hash: version.hash,
    policyId: version.policyId,
    body: version.body,
    presetId: version.presetId,
    createdAt: version.createdAt.toISOString(),
  }
}

async function openShelf(db: Db, name: string): Promise<string> {
  const [shelf] = await db.insert(policies).values({ name }).returning({ id: policies.id })
  if (shelf === undefined) throw new Error('insert into policies returned no row')

  return shelf.id
}
