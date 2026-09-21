/**
 * Blocks on the way in and on disk: one `getBlock` call, and the gzip file a normalised
 * bundle is kept in. Shared by the `slotctl` tool, which builds the curated set, and by
 * the API, which serves it and fills the live cache in the same format (FR-024).
 */

export { fetchBlock } from './rpc.ts'
export type { RpcOptions } from './rpc.ts'
export { readSlot, slotContentHash, slotPath, writeSlot } from './store.ts'
