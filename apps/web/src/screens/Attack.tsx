import { Pending, Screen } from '../components/Screen.tsx'

interface AttackProps {
  /** Which triple of the run to open. 1-based, as printed. */
  triple: number
}

/** Artboard 3. One triple, before and after — T029, on the detector from T025–T028. */
export function Attack({ triple }: AttackProps) {
  return (
    <Screen title="One attack, before and after" subtitle={`Triple ${triple}`}>
      <Pending task="T029">
        The three transactions, the attacker's net balance across the pair, and which primitive
        separated them — or the plain sentence that the attack remains possible. The detector behind
        this screen is T025–T028.
      </Pending>
    </Screen>
  )
}
