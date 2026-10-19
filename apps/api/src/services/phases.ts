/**
 * Milliseconds spent per named phase, summed over many slots — for the log line a batch
 * leaves behind, so that a slow batch on the host says where its time went. Not part of
 * any response.
 */
export class Phases {
  readonly #totals = new Map<string, number>()

  async time<T>(phase: string, work: () => T | Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      return await work()
    } finally {
      this.add(phase, performance.now() - started)
    }
  }

  add(phase: string, ms: number): void {
    this.#totals.set(phase, (this.#totals.get(phase) ?? 0) + ms)
  }

  /** Whole milliseconds per phase, in the order the phases were first seen. */
  totals(): Record<string, number> {
    return Object.fromEntries([...this.#totals].map(([phase, ms]) => [phase, Math.round(ms)]))
  }

  toString(): string {
    return Object.entries(this.totals())
      .map(([phase, ms]) => `${phase} ${ms}`)
      .join(' · ')
  }
}
