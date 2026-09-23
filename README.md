# OrderCraft

A visual builder for transaction-ordering policies, with a simulator that replays
a policy on real Solana slots and shows what it did to the block.

You compose a policy from a few primitives (speed bump, batch auction, allow/deny),
run it on a recorded mainnet slot, and see two orderings side by side: the block as it
was, and the block as it would have been under your policy — with the delay it added,
the transactions it moved, dropped or deferred, and whether a marked sandwich triple
survived.

**What it is not.** There is no integration with Jito BAM, and there will not be one —
the plugin framework is closed. OrderCraft demonstrates a simulation, not production
ordering. The right sentence for it is "here is what your policy would have done to
this block", never "here is how you are protected".

## Status: M2 — deployed and reachable from another computer

The kernel, the CLI and the four web screens run on a curated set of 53 real mainnet
slots that live in this repository. The API, the Postgres schema and the shareable
links are deployed: the site is at
[ordercraft1234.github.io/OrderCraft](https://ordercraft1234.github.io/OrderCraft/)
and it talks to `https://ordercraft-api.onrender.com`. Presets, batch runs and export
are M3.

Idempotency is what this milestone had to prove, and it is proved across machines
rather than inside one process: a run computed locally against the project's Postgres
and the same run asked for through the deployed API come back with the same `id` —
0.71 s to compute it, 0.33 s to hand it back. A policy posted twice is stored once and
keeps its address.

The API runs on a free plan and sleeps after fifteen quiet minutes, so a first request
after a long silence can take the better part of a minute. The screens that wait say
why. A scheduled ping keeps it awake most of the time; it is a convenience, not a
dependency.

The web app therefore has two modes, and neither is a degraded version of the other:

- **Without `VITE_API_URL`** it computes every run in the browser, on the slot the
  repository ships. Nothing is saved, there is no link, and the screens say so. This
  is what a clean clone does — measured at seventeen seconds from `git clone` to a
  reordered block, against a ten-minute budget, with no key, no database and no `.env`.
- **With an address** it saves the policy, asks the API for the run and hands back a
  link — `#/p/<hash>/compare` opens that policy's comparison on anyone's machine. A
  link is access: there is no sign-in and nothing here is private.

Both call the same kernel in the same order, so the figures do not depend on which
answered. Measured on the demo policy and the shipped slot: `moved 334 · delayed 4 ·
dropped 32 · deferred 26 · reordered 32.0 % · max 129 ms`, identical either way.

| Criterion | Budget | Measured | Where |
|---|---|---|---|
| SC-001 run time | slot ≤ 1,500 tx in < 3 s (p95) | **p50 1.5 ms / p95 3.0 ms** | `packages/core/test/performance.test.ts` |
| SC-002 determinism | 50 repeats, 100 % identical | **50/50 identical** | `packages/core/test/determinism.test.ts` |
| SC-003 detector accuracy | recall ≥ 90 % on exhaustively labeled slots; false positives ≤ 5 % of what it reported | **recall 0 of 1 — FAILED.** 42 slots labeled exhaustively (271 leg pairs), one confirmed attack (`445694841 #341/344`, 3 of 3 blind labelers), and the detector is silent on it because the round trip closed at a loss. Precision is unmeasurable: nothing was reported | `packages/fixtures/test/accuracy.test.ts` |
| SC-004 anti-snipe breaks ≥ 95 % of marked triples | — | denominator is one marked triple; the detector does not report it, so the attack screen shows its empty state | same test |

**The gate is red on purpose.** `pnpm gate` ends with 489 passed, 5 skipped and
exactly one failure: `accuracy.test.ts`, "recall 0 of 1 marked attacks across 42
exhaustively checked slots". That failure is a measurement, not a broken build.
Removing the detector's profitability check would give recall 1/1 at 13 % precision
against a 5 % false-positive ceiling, so the rule stays as it is until the denominator
grows. Do not soften the threshold or skip the test.

## Quick start

Requirements: Node ≥ 22.18 (the CLI runs TypeScript directly, no build step) and
pnpm 9. No RPC key is needed for the demo — the curated slots are in the repo.

```sh
pnpm install
pnpm dev          # web app on http://localhost:5173
pnpm gate         # biome check + typecheck + tests (red by design, see above)
```

That is the whole demo: no API address, no database, no RPC key. To run the API too,
copy `.env.example` to `.env`, give it a `DATABASE_URL` and set `VITE_API_URL` to the
API's address — one file at the repository root serves both halves.

Demo walkthrough (under 10 minutes from a clean clone):

1. **Policy** (`#/`). The demo policy is pre-loaded: a speed bump and a batch
   auction on the class "swaps moving ≥ 0.5 wSOL", plus an allow/deny step on the
   three busiest signers of the demo slot. Change a parameter out of range and watch
   the field fail and the policy hash turn into a dash — a half-typed policy never
   compiles.
2. **Comparison** (`#/compare`). The policy runs on slot `445553238` in the browser.
   The ribbon field draws every transaction's move between the recorded position
   and the position under your policy; the figures beneath it (moved, delayed,
   dropped, deferred, p50/p95 delay) come from the same run.
3. **Attack** (`#/attack/1`). One sandwich triple before and after, with the reason
   in words. On the current detector this screen shows its empty state — see SC-003
   above; that is the measured result, not a placeholder.
4. **Report** (`#/report`) is a stub until M3 (batch runs).

## Repository layout

```
packages/core       the simulation kernel — a pure function, no Date/Math/fetch/process
  slot/             SlotBundle: a normalized block, amounts as bigint
  policy/           schema, semantic validation, canonical hash
  primitives/       speedBump, batchAuction, allowDeny
  order/            apply — one total order, one place
  metrics/          run metrics, extracted value
  detect/           sandwich detector, "is it broken", the sieves used to build the label set
packages/shared     the API contract as Zod schemas — one copy, both sides parse it
packages/slots      the RPC client and the on-disk slot format, shared by the API and the CLI
packages/db         Drizzle schema and migrations; tests run on a real Postgres (PGlite, wasm)
packages/fixtures   53 real slots (gzip), 42 label files (labels/), 20 cross-signer label files (labels-cross/)
tools/slotctl       CLI: fetch · fill · scan · review · label · screen · cross · shape
apps/api            Hono 4: /policies, /runs (idempotent on (hash, slot)), /slots, /slots/fetch
apps/web            React 18 + Vite 5, hash router, four screens
design/             the M0 canvas sources (Claude Design artboards)
```

## How the model works — and what it assumes

- **Arrival time is a model, not a measurement.** A slot records order, not time, so
  `arrival(i) = floor(i × 400 / N)`: the i-th of N transactions arrives at that
  millisecond. 400 ms is the protocol's nominal slot; the cache measures ~317 ms per
  slot. The constant works as a scale, not a clock — the run's figures are the same
  under both — and the result screen says so.
- **A policy is a sequence of steps; the order is decided once.** Steps shift time,
  mark batches or drop transactions; `apply` sorts once, by
  `(priority, time, original index, signature)`. A tie is impossible by construction.
- **Deferred is not dropped.** A transaction pushed past the slot boundary was not
  refused by the policy — on this scale it would not have made the block. The two
  are counted separately and the screen shows both.
- **Metrics are descriptive, not counterfactual.** We do not compute how a
  transaction would have executed in another order, and no price is modelled. The
  word "saved" does not appear in the UI. "Extracted value" is the attacker's net
  balance over the triple, per mint, in base units, fee already inside.
- **Money is `bigint`, time is integer milliseconds.** Floating point exists only in
  the UI. In JSON, amounts are strings.
- **Every boundary is validated with Zod**, including the RPC response.

## The curated set and the CLI

The label set is what SC-003 is measured against, and it was built to be
independent of the detector. `slotctl scan` proposes leg pairs with a filter wider
than the detector's rule; `review` prints one pair with everything that moved;
`label` records a blind verdict and derives `coverage: exhaustive` from the count
rather than letting anyone type it; `screen`, `cross` and `shape` are three
successively wider sieves (profitable round trip, cross-signer pairs, shape without
the profit requirement) that were used when the narrower ones found nothing.
Labels were written by blind model agents, one slot each, with no access to the
detector or its rule; that caveat travels with the numbers.

`fetch` and `fill` need `SOLANA_RPC_URL` in the environment; without it the CLI says
so and the curated set is all that is available. See `.env.example`.

```sh
node tools/slotctl/src/cli.ts scan packages/fixtures/slots --out .cache/fixtures-shortlist.json
node tools/slotctl/src/cli.ts review .cache/fixtures-shortlist.json --index 0
```

## Deploy

Two free accounts and one repository variable. Neither is needed to run the demo.

### The web app — GitHub Pages

`.github/workflows/pages.yml` builds `apps/web` on every push to `main` and publishes it
to `https://ordercraft1234.github.io/OrderCraft/`. The workflow runs lint and typecheck
first, not the tests — the test suite is red by measurement (see above), and a deploy must
not depend on that number. There is nothing to configure beyond the first run: GitHub
enables Pages with the Actions source when `deploy-pages` runs for the first time; if it
does not, set **Settings → Pages → Source** to *GitHub Actions* and re-run the workflow.

Routes are hash-based (`#/compare`), so a project page under `/OrderCraft/` needs no
rewrite rule — only the asset prefix, which Vite gets as `BASE_PATH`. A custom domain
later means one repository variable, `PAGES_BASE_PATH=/`, and nothing in the code.
To check the Pages build locally:

```sh
BASE_PATH=/OrderCraft/ pnpm --filter @ordercraft/web build   # MSYS_NO_PATHCONV=1 in Git Bash
```

The API address is a repository **variable**, not a secret: it ends up in the bundle
either way, and there is nothing behind it that a name would protect. Settings →
Secrets and variables → **Actions** → Variables → `API_URL`. Leave it unset and the
site builds in browser-only mode, which is a working site rather than a broken one.

### The API — Render, and Postgres — Supabase

Both are live. What follows is how they were set up, and how to do it again.

`render.yaml` is a Blueprint: Render → New → **Blueprint** → this repository, then fill
in the four variables it marks `sync: false`. The free plan gives one web service, no
background worker, an ephemeral filesystem and a container that sleeps after fifteen
quiet minutes; the file says what each of those costs and where it is handled.

Supabase gives two connection strings and they are not interchangeable:

| | Port | Used for |
|---|---|---|
| Session pooler | 5432 | `db:migrate`, from a laptop, before the deploy that needs it |
| Transaction pooler | 6543 | the running service — `createDb` turns prepared statements off when it sees this port |

Direct `db.<project>.supabase.co:5432` is IPv6-only and will not resolve from most
places; use the poolers. The role is `postgres`, not `anon`. There is no RLS: the
product has no accounts by decision (FR-020), and a policy on a table nobody owns
would protect nothing.

```sh
# once per schema change, before the deploy that needs it
DATABASE_URL_MIGRATE='postgresql://postgres.<project>:<password>@<host>:5432/postgres' \
  pnpm --filter @ordercraft/db db:migrate
```

Migrations are deliberately not run by the service at boot: a deploy that migrated on
the way up would turn every rollback into a data question.

Last, `.github/workflows/keepalive.yml` pings `/health` every five minutes so the
first visitor does not pay the cold start. It reads the same `API_URL` variable and
does nothing without it.

## Roadmap

- **M2 — visible from another computer.** Hono API, Postgres (Supabase), policies
  and runs saved by hash, links (a link is access; there is no privacy). Done and
  deployed.
- **M3 — presets, batch runs, export.** A preset library in code, p50/p95 over many
  slots with progress, JSON-DSL export/import with a hash round-trip, and a
  TypeScript interface stub with the disclaimer that it is not a BAM config.

## Working on it

- `pnpm check` runs Biome for lint **and** format; format drift fails the gate.
- `packages/core` is guarded twice: a Biome rule bans `Date`, `Math`, `fetch` and
  `process`, and a test walks the dependency graph so the package cannot pull in
  anything but `zod` and `@noble/hashes`.
- `packages/fixtures/slots/**` and `labels/**` are machine-written and skipped by
  the formatter; their structure is checked by schema in the tests instead.
- One task, one commit. The commit message says what was measured and why the
  decision went the way it did.
