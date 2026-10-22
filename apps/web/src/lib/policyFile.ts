import { type PolicyImport, importPolicy } from '@ordercraft/core'

/**
 * A ceiling well above the largest policy the schema allows — twelve steps of twenty
 * rules of twenty addresses is about a quarter of a megabyte, indented — so that a
 * wrong file picked by mistake is refused before it is read into a string.
 */
export const MAX_POLICY_FILE_BYTES = 1_000_000

const NAME_LIMIT = 60

/**
 * The file name a download is offered under. ASCII letters and digits only, words joined
 * by dashes: the file is meant to be committed into somebody's repository, where a name
 * with spaces or guillemets is a nuisance on every command line. A name with nothing
 * left after that is called `policy`.
 */
export function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, NAME_LIMIT)
    .replace(/^-+|-+$/g, '')

  return `${slug === '' ? 'policy' : slug}.ordercraft.json`
}

/** The part of a browser `File` this needs, so a test can hand it a plain object. */
interface PickedFile {
  size: number
  text(): Promise<string>
}

export async function readPolicyFile(file: PickedFile): Promise<PolicyImport> {
  if (file.size > MAX_POLICY_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: 'not-a-policy-file',
        message: `the file is ${Math.ceil(file.size / 1000).toLocaleString('en-US')} KB; a policy file is never larger than ${MAX_POLICY_FILE_BYTES / 1_000_000} MB`,
      },
    }
  }

  return importPolicy(await file.text())
}
