import { POLICY_FILE_NOTICE, type Policy, type PolicyImport, exportPolicy } from '@ordercraft/core'
import { type ChangeEvent, useState } from 'react'
import { fileNameFor, readPolicyFile } from '../lib/policyFile.ts'

type Opened = Extract<PolicyImport, { ok: true }>

interface PolicyFileProps {
  /** The compiled policy, or `null` while the draft is not one. */
  policy: Policy | null
  /** Why it cannot be exported yet, in the builder's own words, or `null`. */
  blocked: string | null
  /** The preset the policy started from; written beside it, outside the hash. */
  origin: string | null
  /** Whether replacing the draft would lose something that exists only in this tab. */
  unsaved: boolean
  onOpen: (file: Opened) => void
}

type FileState =
  | { status: 'idle' }
  | { status: 'failed'; reason: string }
  | { status: 'pending'; file: Opened; name: string }
  | { status: 'opened'; name: string }

/**
 * The policy as a file to take away, and back (FR-018, US5). Export works without an API:
 * the file is made here from what the builder holds, and needs nothing the tab does not
 * already have.
 *
 * Export is offered under the same condition as saving: a policy that would order
 * nothing meaningful is not an artifact worth carrying into somebody's repository.
 * Import over an unsaved draft asks first, as choosing a preset does.
 */
export function PolicyFile({ policy, blocked, origin, unsaved, onOpen }: PolicyFileProps) {
  const [state, setState] = useState<FileState>({ status: 'idle' })

  const download = () => {
    if (policy === null) return
    try {
      const text = exportPolicy(policy, origin === null ? {} : { presetId: origin })
      offerDownload(text, fileNameFor(policy.name))
      setState({ status: 'idle' })
    } catch (error) {
      setState({ status: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    // Cleared so that picking the same file again, after fixing it, fires a change.
    event.target.value = ''
    if (picked === undefined) return

    readPolicyFile(picked).then(
      (result) => {
        if (!result.ok) {
          setState({ status: 'failed', reason: `${picked.name}: ${result.error.message}.` })
        } else if (unsaved) {
          setState({ status: 'pending', file: result, name: picked.name })
        } else {
          open(result, picked.name)
        }
      },
      (error: unknown) => setState({ status: 'failed', reason: String(error) }),
    )
  }

  const open = (file: Opened, name: string) => {
    onOpen(file)
    setState({ status: 'opened', name })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted">File</div>

      <div className="flex flex-wrap items-baseline gap-3">
        <button
          type="button"
          disabled={policy === null || blocked !== null}
          onClick={download}
          className="text-[12px] underline underline-offset-4 disabled:text-muted disabled:no-underline disabled:opacity-40"
        >
          Export policy file
        </button>
        <label className="cursor-pointer text-[12px] underline underline-offset-4 focus-within:outline focus-within:outline-1">
          Import a file
          <input type="file" accept=".json,application/json" onChange={pick} className="sr-only" />
        </label>
        <span className="text-[11px] text-muted">
          {blocked ?? 'JSON with the schema version, the steps and the content hash'}
        </span>
      </div>

      {state.status === 'failed' ? (
        <div className="max-w-[620px] break-words text-[12px] text-extracted">{state.reason}</div>
      ) : null}

      {state.status === 'opened' ? (
        <div className="text-[12px] text-muted">
          Opened {state.name}; the content hash matches the file.
        </div>
      ) : null}

      {state.status === 'pending' ? (
        <div className="flex flex-wrap items-baseline gap-3 text-[12px]">
          <span>Replace the current policy with {state.name}? It is not saved.</span>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => open(state.file, state.name)}
          >
            replace
          </button>
          <button
            type="button"
            className="text-muted underline underline-offset-4 hover:text-ink"
            onClick={() => setState({ status: 'idle' })}
          >
            keep
          </button>
        </div>
      ) : null}

      <p className="max-w-[620px] text-[12px] text-muted">{POLICY_FILE_NOTICE}</p>
    </div>
  )
}

function offerDownload(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
