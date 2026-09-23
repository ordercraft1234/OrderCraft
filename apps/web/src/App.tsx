import type { ReactNode } from 'react'
import { Frame } from './components/Frame.tsx'
import { Screen } from './components/Screen.tsx'
import type { Route } from './lib/router.ts'
import { useLocation } from './lib/useLocation.ts'
import { type PolicySession, usePolicySession } from './lib/usePolicySession.ts'
import { Attack } from './screens/Attack.tsx'
import { Builder } from './screens/Builder.tsx'
import { Compare } from './screens/Compare.tsx'
import { NotFound } from './screens/NotFound.tsx'
import { Report } from './screens/Report.tsx'

/**
 * The policy lives here rather than inside the builder, because three screens need the
 * same one: the builder edits it, the comparison replays it, the attack screen judges
 * one triple of it.
 *
 * Where it comes from depends on the address. `#/p/<hash>/…` names a policy the API
 * stored, and the session fetches it; anything else opens on the demo policy, because
 * the slot ships with the repository and a visitor who types nothing should still see a
 * block reordered.
 *
 * The prefix handed down to the navigation is **not** the address that was opened — it
 * is the address of what is currently on screen, which is `null` as soon as somebody
 * edits. A link that survived an edit would be an invitation to send somebody a policy
 * they are not looking at.
 */
export function App() {
  const location = useLocation()
  const session = usePolicySession(location.policyHash)
  const linkHash = session.stored ? session.draftHash : null

  return (
    <Frame current={location.route} policyHash={linkHash}>
      <ScreenFor route={location.route} session={session} policyHash={linkHash} />
    </Frame>
  )
}

interface ScreenForProps {
  route: Route
  session: PolicySession
  policyHash: string | null
}

function ScreenFor({ route, session, policyHash }: ScreenForProps) {
  // A link that names a policy is about that policy on every one of its screens, so
  // the wait and the failure are handled once here rather than four times below. The
  // draft underneath is still the demo one at this point, and drawing it would answer
  // somebody's link with a policy they did not ask for.
  if (session.load.status === 'loading') {
    return (
      <Screen title="Opening a saved policy" subtitle={short(session.load.hash)}>
        <Note>
          Fetching the policy this link names. On a free-plan API the first request after a quiet
          spell also has to wake the server up.
        </Note>
      </Screen>
    )
  }

  if (session.load.status === 'failed') {
    return (
      <Screen title="That link did not open" subtitle={short(session.load.hash)}>
        <Note>{session.load.reason}</Note>
        <Note>
          To use the app meanwhile, open it without the link: it starts from the demo policy, on the
          slot the repository ships.
        </Note>
      </Screen>
    )
  }

  switch (route.name) {
    case 'builder':
      return <Builder session={session} />
    case 'compare':
      return <Compare session={session} />
    case 'attack':
      return <Attack triple={route.triple} session={session} policyHash={policyHash} />
    case 'report':
      return <Report />
    case 'notFound':
      return <NotFound path={route.path} />
  }
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-[620px] text-[12px] text-muted">{children}</p>
}

function short(hash: string): string {
  return `policy ${hash.slice(0, 12)}`
}
