import { type SlotBundle, slotBundleSchema } from '@ordercraft/core'

/**
 * The slot the comparison screen opens on. It lives in the repository instead of
 * being fetched: a demo that needs an RPC key is a demo that fails on the machine of
 * the person being shown it, and SC-009 asks a clean clone to run in ten minutes.
 */
export const DEMO_SLOT = 445625228

/**
 * The fixture as a URL. `new URL(..., import.meta.url)` is the expression a bundler
 * follows to emit the file as an asset and the one Node resolves to a path, so the
 * browser and the tests read the same bytes. The number is spelled out because a
 * bundler cannot follow a template literal — `demo.test.ts` checks it still agrees
 * with `DEMO_SLOT`.
 */
export const demoSlotUrl = new URL('../slots/445625228.json.gz', import.meta.url).href

/** First two bytes of a gzip member. */
const GZIP_MAGIC: readonly [number, number] = [0x1f, 0x8b]

/**
 * Bytes in, bundle out — compressed or not.
 *
 * The `.gz` name is a claim about the file, and static servers act on it: `vite
 * preview` answers with `Content-Encoding: gzip` even when the request asks for
 * `identity`, so the browser unwraps the file before we ever see it, while a host
 * that treats the extension as opaque hands the gzip through untouched. Sniffing two
 * bytes costs less than pinning down the behaviour of every host the demo will run
 * on, and it fails the same way on both when the file is truncated.
 *
 * The schema still runs. The file is 1.2 MB of JSON nobody reads, and a bad one has
 * to fail here rather than three screens later.
 */
export async function decodeSlotBundle(bytes: Uint8Array<ArrayBuffer>): Promise<SlotBundle> {
  const text = isGzip(bytes) ? await gunzip(bytes) : new TextDecoder().decode(bytes)
  return slotBundleSchema.parse(JSON.parse(text))
}

/**
 * Browser path: fetch the asset, then decode it. Node's `fetch` refuses `file:` URLs,
 * so tests and command-line tools read the file themselves and call
 * `decodeSlotBundle` directly.
 */
export async function loadSlotBundle(url: string = demoSlotUrl): Promise<SlotBundle> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`fixture ${url} failed: HTTP ${response.status} ${response.statusText}`)
  }

  return decodeSlotBundle(new Uint8Array(await response.arrayBuffer()))
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
}

/**
 * `DecompressionStream` rather than `node:zlib`: the package has to load in a browser,
 * and the streams API is the one decompressor both runtimes already have.
 *
 * The parameter is `Uint8Array<ArrayBuffer>` and not plain `Uint8Array` because a view
 * backed by a `SharedArrayBuffer` is not a valid request body; `new Uint8Array(bytes)`
 * at the call site is the whole cost of saying so.
 */
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const compressed = new Response(bytes).body
  if (compressed === null) {
    throw new Error('decodeSlotBundle was handed bytes with no readable body')
  }

  return new Response(compressed.pipeThrough(new DecompressionStream('gzip'))).text()
}
