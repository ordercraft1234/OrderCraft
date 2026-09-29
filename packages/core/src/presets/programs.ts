/**
 * Public on-chain addresses the preset library selects by. Every one of them is a
 * program or a mint, never a person: a preset ships to everyone, and a signer list in
 * it would be somebody else's decision about whom to refuse.
 *
 * Each was checked against the 53 curated slots on 2026-09-29 (35,427 non-vote
 * transactions). The counts are the evidence that a class drawn from these addresses
 * selects something on real blocks; `packages/fixtures/test/presets.test.ts` keeps them
 * honest when the set changes.
 */
export const PROGRAMS = {
  /** pump.fun bonding curve: 1,208 transactions in 49 of 53 slots. */
  pumpFun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  /** Meteora dynamic bonding curve: 127 transactions in 29 slots. */
  meteoraDbc: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  /** Raydium LaunchLab: 8 transactions in 5 slots. */
  raydiumLaunchLab: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  /**
   * The three proprietary AMMs below appear in 2,071 transactions, and **none of them
   * moves a token**. In these slots a transaction naming one of them is a quote update
   * by its market maker; swaps against them arrive through an aggregator and name the
   * aggregator instead. That is what lets a program selector tell a quote from a taker.
   */
  humidiFi: '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
  /** Tessera V: see `humidiFi`. */
  tesseraV: 'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH',
  /** ZeroFi: see `humidiFi`. */
  zeroFi: 'ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY',
} as const

/** Wrapped SOL. Nine decimals, so one SOL is 1,000,000,000 base units. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
