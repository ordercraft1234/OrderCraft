import { Pending, Screen } from '../components/Screen.tsx'

/** Artboard 4. One policy across many blocks — T040, on the batch metrics of T038. */
export function Report() {
  return (
    <Screen title="Across many blocks">
      <Pending task="T040">
        Distributions rather than averages: one bar per measure, p10 to p90 with p50 and p95 marked,
        each on its own labelled axis. Needs the batch run of T038–T039.
      </Pending>
    </Screen>
  )
}
