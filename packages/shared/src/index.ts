/**
 * The API contract, as Zod schemas, for both sides of it.
 *
 * `apps/api` validates every request against these and answers in these shapes;
 * `apps/web` parses every answer back through them. A field that exists in one place
 * and not the other cannot happen, because there is one place. The kernel's own types
 * are not redeclared here — `policySchema` and `slotBundleSchema` are the kernel's, and
 * the run schemas are checked against the kernel's types in `test/types.test.ts`.
 *
 * Numbers that do not fit a JSON number travel as strings and come back as bigints:
 * see `serializeRun` and the `Serialized*` types beside each schema.
 */

export { ERROR_STATUS, apiError, apiErrorSchema, errorCode } from './error.ts'
export type { ApiError, ErrorCode } from './error.ts'
export {
  MAX_SLOT,
  bigintString,
  integerString,
  policyHashHex,
  presetId,
  slotNumber,
  slotSegment,
  timestamp,
  uuid,
} from './scalars.ts'
export {
  createPolicyRequestSchema,
  createPolicyResponseSchema,
  policyHashParamSchema,
  policyIdParamSchema,
  policyVersionSummarySchema,
  policyVersionViewSchema,
  policyViewSchema,
} from './policies.ts'
export type {
  CreatePolicyRequest,
  CreatePolicyResponse,
  PolicyVersionView,
  PolicyView,
} from './policies.ts'
export {
  fetchSlotRequestSchema,
  fetchSlotResponseSchema,
  listSlotsQuerySchema,
  listSlotsResponseSchema,
  slotBundleResponseSchema,
  slotParamSchema,
  slotSource,
  slotSummarySchema,
} from './slots.ts'
export type { FetchSlotRequest, FetchSlotResponse, SlotSource, SlotSummary } from './slots.ts'
export {
  attackSchema,
  createRunRequestSchema,
  extractedValueSchema,
  hydrateOrdering,
  orderingSchema,
  placementSchema,
  runIdParamSchema,
  runMetricsSchema,
  runSchema,
  serializeExtractedValue,
  serializeOrdering,
  serializeRun,
  tripleOutcomeSchema,
} from './runs.ts'
export type {
  Attack,
  CreateRunRequest,
  OrderingWire,
  PlacementWire,
  Run,
  SerializedAttack,
  SerializedExtractedValue,
  SerializedRun,
} from './runs.ts'
export {
  MAX_BATCH_SLOTS,
  batchEventSchema,
  batchIdParamSchema,
  batchStatus,
  batchViewSchema,
  cancelBatchResponseSchema,
  createBatchRequestSchema,
  createBatchResponseSchema,
} from './batches.ts'
export type { BatchEvent, BatchStatus, BatchView, CreateBatchRequest } from './batches.ts'
