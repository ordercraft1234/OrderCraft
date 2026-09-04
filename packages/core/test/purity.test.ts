import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

/**
 * Everything `packages/core` is allowed to reach for. Both are pure: `zod` describes
 * shapes, `@noble/hashes` hashes bytes. Neither reads a clock, a network or an
 * environment, and a third entry here needs an argument, not a commit.
 */
const ALLOWED_PACKAGES = ['zod', '@noble/hashes']

/**
 * The globals a deterministic package may not touch. Biome enforces this on the source;
 * the list is repeated here so that deleting the rule fails a test rather than passing
 * quietly — a lint rule nobody notices is gone is not a guarantee.
 */
const DENIED_GLOBALS = ['Date', 'Math', 'fetch', 'process', 'performance']

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

function importsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const specifiers: string[] = []

  for (const match of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== undefined) specifiers.push(match[1])
  }

  return specifiers
}

const files = sourceFiles(SOURCE)

/**
 * FR-011. `packages/core` is the part of the product that has to give the same answer
 * twice, and the guarantee is structural rather than a habit: what it cannot import,
 * it cannot become non-deterministic through.
 */
describe('core purity (FR-011)', () => {
  it('has source files to check', () => {
    // Guards the guard: a broken path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(8)
  })

  it('imports nothing outside the allowlist', () => {
    const external = files.flatMap((path) =>
      importsOf(path).filter((specifier) => !specifier.startsWith('.')),
    )

    // Guards the guard again: an empty scan would make the assertion below pass on
    // a package that imports the whole world.
    expect(external).toContain('zod')

    const outside = files.flatMap((path) =>
      importsOf(path)
        .filter((specifier) => !specifier.startsWith('.'))
        .filter(
          (specifier) =>
            !ALLOWED_PACKAGES.some(
              (allowed) => specifier === allowed || specifier.startsWith(`${allowed}/`),
            ),
        )
        .map((specifier) => `${path}: ${specifier}`),
    )

    expect(outside).toEqual([])
  })

  it('imports no Node built-ins', () => {
    const builtins = files.flatMap((path) =>
      importsOf(path)
        .filter((specifier) => specifier.startsWith('node:'))
        .map((specifier) => `${path}: ${specifier}`),
    )

    expect(builtins).toEqual([])
  })

  it('loads nothing at run time', () => {
    // A dynamic import or a `require` would route around every check above.
    const dynamic = files.filter((path) =>
      /\bimport\s*\(|\brequire\s*\(/.test(readFileSync(path, 'utf8')),
    )

    expect(dynamic).toEqual([])
  })

  it('declares no dependencies beyond the allowlist', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> }

    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...ALLOWED_PACKAGES].sort())
  })

  it('still has the Biome rule that denies non-deterministic globals', () => {
    const biome = JSON.parse(readFileSync(join(ROOT, 'biome.json'), 'utf8')) as {
      overrides?: {
        include?: string[]
        linter?: {
          rules?: { style?: { noRestrictedGlobals?: { options?: { deniedGlobals?: string[] } } } }
        }
      }[]
    }

    const override = biome.overrides?.find((entry) =>
      entry.include?.some((pattern) => pattern.startsWith('packages/core/src')),
    )
    const denied = override?.linter?.rules?.style?.noRestrictedGlobals?.options?.deniedGlobals ?? []

    for (const global of DENIED_GLOBALS) {
      expect(denied).toContain(global)
    }
  })
})
