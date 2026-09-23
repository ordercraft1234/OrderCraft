import type { Policy } from '@ordercraft/core'
import { type ReactNode, useState } from 'react'
import { ApiFailure, api } from '../lib/api.ts'
import { toHash } from '../lib/router.ts'
import { policyLink } from '../lib/useLocation.ts'

interface SavePolicyProps {
  /** The compiled policy, or `null` while the draft is not one. */
  policy: Policy | null
  /** Its content address — the address the link is built from. */
  hash: string | null
  /** Whether this exact content is already stored, and so already has a link. */
  stored: boolean
  onStored: (hash: string) => void
  /** Why it cannot be saved yet, in the builder's own words, or `null`. */
  blocked: string | null
}

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'failed'; reason: string }

/**
 * Saving a policy, and the sentence that has to appear with the link (FR-020, T046).
 *
 * The line about access is printed **with the link and never before it**. Said on an
 * empty screen it is a policy notice nobody reads; said beside an address somebody is
 * about to send to a colleague it is the one fact they need — there is no sign-in here,
 * and a link is the whole of the access control.
 */
export function SavePolicy({ policy, hash, stored, onStored, blocked }: SavePolicyProps) {
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  // Bound to a local so the click handler below keeps the narrowing: an imported
  // binding is not narrowed inside a closure, however constant it is.
  const client = api

  if (client === null) {
    return (
      <Section>
        <div className="text-[12px] text-muted">
          This build was made without an API address, so a policy cannot be saved and has no link.
          It lives in this tab, and the run is computed here on the slot the repository ships.
        </div>
      </Section>
    )
  }

  const save = () => {
    if (policy === null) return
    setState({ status: 'saving' })

    client.savePolicy(policy).then(
      (saved) => {
        onStored(saved.hash)
        setState({ status: 'idle' })
      },
      (error: unknown) => setState({ status: 'failed', reason: reasonOf(error) }),
    )
  }

  return (
    <Section>
      <div className="flex flex-wrap items-baseline gap-3">
        <button
          type="button"
          disabled={policy === null || blocked !== null || state.status === 'saving'}
          onClick={save}
          className="text-[12px] underline underline-offset-4 disabled:text-muted disabled:no-underline disabled:opacity-40"
        >
          {stored ? 'Save again' : 'Save and get a link'}
        </button>
        <span className="text-[11px] text-muted">
          {blocked ?? (state.status === 'saving' ? 'saving…' : `to ${client.url}`)}
        </span>
      </div>

      {state.status === 'failed' ? (
        <div className="max-w-[620px] text-[12px] text-extracted">{state.reason}</div>
      ) : null}

      {stored && hash !== null ? <Link hash={hash} /> : null}
    </Section>
  )
}

function Link({ hash }: { hash: string }) {
  const url = policyLink(hash)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <a
          href={toHash({ name: 'builder' }, hash)}
          className="max-w-full break-all text-[12px] underline underline-offset-4"
        >
          {url}
        </a>
        <button
          type="button"
          onClick={copy}
          className="text-[11px] uppercase tracking-[0.16em] text-muted hover:text-ink"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      <p className="max-w-[620px] text-[12px]">
        A link is access. There is no sign-in and nothing here is private: whoever has this address
        can open the policy and every run made on it.
      </p>
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Save</div>
      {children}
    </div>
  )
}

/**
 * The server's refusal in the builder's register. Only the codes a policy can actually
 * provoke are spelled out; the rest arrive with the API's own message, which is written
 * for this screen too.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof ApiFailure)) return error instanceof Error ? error.message : String(error)

  switch (error.code) {
    case 'UNREACHABLE':
      return `The API did not answer. On a free plan the first request after a quiet spell wakes the server up and can take half a minute — try again. (${error.message})`
    case 'INVALID_INPUT':
      return `The API refused this policy: ${error.message}`
    default:
      return error.message
  }
}
