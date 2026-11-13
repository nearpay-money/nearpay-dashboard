# nearpay-dashboard

The merchant dashboard: payments, refunds (signed with the merchant's wallet), invoices, subscriptions, customers, developer tools (keys, webhooks, events, live tail), payout wallets and team.

Part of [NearPay](https://github.com/nearpay-money/nearpay) — start there for the live demo, the architecture diagram and the full "do X, see Y" walkthrough.

- **Where it sits:** a static single-page app served at https://dashboard.nearpay.money. Every request goes same-origin to `/api/<spec path>`, which the gateway routes to identity, payments, billing, webhooks, agentpay and rails. It holds no state of its own.
- **Status:** NearPay runs on NEAR mainnet as a closed beta (https://nearpay.money). This app is the dashboard of that deployment. Sign-up is open (no business review; the registration number is optional, ADR-0024), sign-in is by passkey or "Continue with Google" (ADR-0026), and a payout wallet is active as soon as its ownership signature verifies (no cool-off, ADR-0027).

|                                       |                                    |
| ------------------------------------- | ---------------------------------- |
| Group                                 | Frontends                          |
| Kind                                  | static SPA                         |
| Ships as                              | dashboard.nearpay.money            |
| Owns                                  | — (stateless)                      |
| Depends on (published artifacts only) | spec (public + dashboard), gateway |
| First built in                        | Stage 1 (step 1.3)                 |

## Documentation

Design docs live in [`nearpay-brain`](https://github.com/nearpay-money/nearpay-brain), not here.

- [`lld/dashboard-and-console.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/lld/dashboard-and-console.md) — low-level design this repo is implemented from
- [`lld/audits/dashboard-and-console.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/lld/audits/dashboard-and-console.md) — audit findings already folded into the LLD
- [`roadmap/development-plan.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/roadmap/development-plan.md) — stage and step this repo is built in
- [`architecture/hld.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/hld.md) — system design
- [`architecture/repositories.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/repositories.md) — repo topology and dependency rules
- [`architecture/api-conventions.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/api-conventions.md)
- [`architecture/flows.md#4-refund-merchant-authorised`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/flows.md#4-refund-merchant-authorised)

## What is built (Stage 1, `lld/dashboard-and-console.md` §1)

| Area                                                                                 | Routes (spec)                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up / sign-in (`/signup`, `/auth/verify#token=…`, `/signin`)                     | Turnstile → `signup`; `verifyMagicLink`; passkeys via `@simplewebauthn/browser` (`passkeyRegistration*`, `passkeyAuthentication*`); "Continue with Google" (ADR-0026, run by identity; passkeys still confirm sensitive actions); `logout`                           |
| Step-up dialog                                                                       | any `401 step_up_required` → `stepUpOptions`/`stepUpVerify`, then the request is replayed once with the same Idempotency-Key                                                                                                                                         |
| Test/live switch                                                                     | `?mode=live` in the URL, `NearPay-Mode` on every call; live-only writes (keys, webhooks) disabled until `requirements.live_enabled`                                                                                                                                  |
| Home (`/`)                                                                           | `getAccountRequirements` checklist, `startKyb`, recent `listPaymentIntents`                                                                                                                                                                                          |
| Payments (`/payments`, `/payments/:id`)                                              | `listPaymentIntents`, `getPaymentIntent` (attempts timeline, evidence explorer links), `listBalanceTransactions`, `getCheckoutSession`; destination fingerprint computed client-side (spec vector)                                                                   |
| Agent payments (`/agent-payments[/:id]`)                                             | `listAgentPayments`, `getAgentPayment`                                                                                                                                                                                                                               |
| Settlement (`/settlement`, `/settlement/new`, `/settlement/:id/attest`)              | `list/get/create/attest/challenge/setDefault/disableSettlementDestination`; NEP-413 via NEAR Connect, EIP-191 via EIP-6963/injected wallets; new challenge for a pending destination (step-up); active right after verification (no cool-off, ADR-0027); fingerprint |
| Developers (`/developers`, `/developers/webhooks[/:id]`, `/developers/events[/:id]`) | API keys (create/roll/revoke, secret shown once), webhook endpoints (create/update/test/delete) with the delivery log (`listWebhookEndpointDeliveries`, paginated), events                                                                                           |
| Settings (`/settings`)                                                               | `getAccount`/`updateAccount` (money settings trigger step-up), add a passkey                                                                                                                                                                                         |

Session: the `__Host-np_session` cookie is the credential; the session and its CSRF token are kept in memory
only and sent as `X-CSRF-Token` on unsafe methods. A reload or a new tab recovers them with
`getDashboardSession` (`GET /v1/auth/session`); nothing is written to web storage. Every request goes to
`/api/<spec path>` same-origin (Traefik strips `/api`). Responses are parsed with the spec's
`safeParseTolerant`: unknown open-enum values render as received, other contract breaks show `invalid_response`.

## Step 2.3 (dashboard core + Stage 2 areas)

- UI on `@nearpay-internal/ui` 0.2.0 (kit `fonts.css`, `tokens.css`, `styles.css` at the entry; app layout in
  `src/styles.css`). Shell: kit AppShell, sidebar slots filled from the feature registry (`src/app/registry.ts`:
  every `src/features/<area>/module.tsx` is discovered at build time; the Stage 2 areas' `index.ts` exports are
  mounted lazily by `src/app/features.tsx`, one chunk per area), account switcher (`listMemberships` /
  `switchSessionAccount`), Live/Test switch, notifications from real data, drawer below 960 px.
- Pages: Overview (stats and the daily volume chart computed from `listPaymentIntents`), onboarding checklist
  (`/setup`), payments list (ADR-0018 filters kept in the URL, CSV export), payment detail (refunds card + refund
  flow from the refunds area), settlement (two-approver `approval` where a second owner or admin must approve; no
  waiting period afterwards, ADR-0027), developers (restricted keys with the
  `KEY_SCOPES` matrix, secret rotation, resend), developer onboarding (`/developers/start`), agent payments (paid
  resources from real payments; "Add paid resource" generates the x402 server code), settings index + account and
  notification pages; Stage 2 areas: refunds, payment links, customers, team, business details (KYB), audit log,
  checkout appearance.
- Tests: `test/unit` + `src/features/**/*.test.ts` (Vitest); Playwright runs `test/e2e/**/*.spec.ts` and
  `src/features/**/*.e2e.ts`. `NP_SHOTS=<dir> pnpm e2e shots` saves review screenshots (1440 / 390 px).

## Step 3.3 (Stage 3 clients)

- Billing (`/billing…`, Figma b02): hub with stats and tabs; invoices (status filters, draft create/edit with a tax
  preview from the spec's `computeInvoiceTotals`, finalize, send with the 10-minute limit, void, mark
  uncollectible, payment link, PDF via `ApiClient.download`, activity from events, linked payments); subscriptions
  (create, cancel now / at period end, upcoming renewal estimate, dunning status); products & prices; tax rates
  (exact decimal percentages). Customer pages gain Invoices / Subscriptions tabs.
- `/cli/authorize?code=` (focus layout): approve a `nearpay login` with passkey step-up, or deny.
- Developers → Live tail (`/developers/live`): `GET /v1/events/stream` read with `fetch` (`src/lib/sse.ts`) so the
  session mode follows the Test/Live switch; resumes with `Last-Event-ID`; pause / resume / clear.
- Spec 0.2.1 CRs: customer totals, payment link names, saved checkout theme and corners, payer sent / refund
  address, member security, destination `created_by` and expiry, approver tenure.
- Stage 3 pages show by default (`VITE_NP_STAGE` defaults to 3).

## Step 4.3 (Stage 4 clients)

- Auto-debit (`lld/billing.md` §14): Billing → Auto-debit tab (mandates with status / link / payer filters),
  mandate page (balance, periods left, next collection, collections with NEAR evidence, keeper failures, unlinked
  reasons, test-mode payer helpers), merchant cancel via `prepareMandateCancel` signed with the receiving account's
  NEAR wallet (transaction checked and summarised first). Subscriptions: collection method with eligibility on
  create and on the page, auto-debit panel (linked mandate, amount-locked notice, hosted-invoice setup link,
  `prepareMandate` funding details, simulated funding in test mode). `mandate.*` in Developers.
- Solana and Bitcoin destinations (`lld/identity.md` §20): address checks (P2WPKH / P2TR only), Wallet Standard
  `solana:signMessage` or pasted base58 signature, BIP-322 simple via UniSat / OKX or pasted base64.
- Contracts: `@nearpay-money/spec` 0.4.0 (mandates, `Subscription.mandate`, `Invoice.mandate_collection`, `mandate.*`
  events, `standard: solana | bip322`); Solana/Bitcoin checks are tested against its `test-vectors`.
- Stage 4 pages show by default (`VITE_NP_STAGE` defaults to 4).

## Verify this repo

Needs Node 22 (`.nvmrc`), pnpm 9 and, for step 4, Google Chrome. No Docker. `.npmrc` points the `@nearpay-money` and `@nearpay-internal` scopes at a local package registry, so start that first.

1. Start the local registry (no Docker, Node 22 only):
   `git clone https://github.com/nearpay-money/nearpay-deploy ../nearpay-deploy && ../nearpay-deploy/scripts/registry.sh start`
   → `curl http://127.0.0.1:4873/-/ping` answers `{}`.
2. `pnpm install --frozen-lockfile` → ends with `Done in …`, no registry errors.
3. `pnpm test` (unit tests: API client, session recovery, money formatting, signing helpers, feature logic) → `Test Files  26 passed (26)`, `Tests  279 passed (279)`.
4. `pnpm verify` (the full gate: typecheck, lint, unit tests with the coverage gate, build, then Playwright end-to-end tests of the built app against a spec-driven mock of `/api`) → exits 0; the Playwright list ends with `105 passed` and `5 skipped` (about 4 minutes). The browser is the system Chrome at `/usr/bin/google-chrome`; set `NP_CHROME_PATH` to another path if needed.

To use the dashboard for real, follow the walkthrough in the [entry repo](https://github.com/nearpay-money/nearpay).

## Build and deploy

```
pnpm install --frozen-lockfile
pnpm build            # → dist/ (index.html + assets/ + favicon.svg), served by nearpay-deploy as the `dashboard` site
pnpm verify           # typecheck + Biome + unit tests (coverage ≥ 90% branches and lines on src/lib, src/wallets) + build + Playwright
```

- `nearpay-deploy/scripts/up.sh` mounts `nearpay-dashboard/dist` when `dist/index.html` exists; nginx serves
  `/assets/*` immutable and falls back to `index.html` for every other path; `/api/*` is routed by Traefik.
- Build-time env (optional): `VITE_API_BASE` (default `/api`), `VITE_TURNSTILE_SITEKEY` (default Cloudflare's
  always-pass test key `1x00000000000000000000AA`; with the test key and no network the documented dummy token
  is used), `VITE_NEAR_NETWORK` (`mainnet`).
- CSP: `index.html` carries the policy (script-src `'self'`, Turnstile and a nonce placeholder `NPCSPNONCE`;
  style-src allows inline styles for NEAR Connect's popup). The static server should replace `NPCSPNONCE` per
  response (nginx `sub_filter` with `$request_id`) so NEAR Connect's sandboxed wallet iframes get a real nonce.
- Local development against the stack: `pnpm dev` proxies `/api` to `https://dashboard.nearpay.localhost`.

## Tests

- `test/unit` (Vitest, Node): API client (headers, CSRF, idempotency, step-up replay, session loss, tolerant
  response parsing), session recovery, integer money formatting, fingerprint vs `@nearpay-money/spec/test-vectors/destination-fingerprint.json`,
  explorer links, role/live gates from the spec route table, EVM/NEAR signing helpers.
- `test/e2e` (Playwright on system Chrome, `NP_CHROME_PATH`, default `/usr/bin/google-chrome`): the built app
  against a spec-driven mock of `/api` (`test/e2e/mock-api.ts`: strict body/query validation, CSRF, mode header,
  Idempotency-Key, roles, step-up; responses validated against the spec), a CDP virtual WebAuthn authenticator,
  an EIP-6963 test wallet and a NEAR Connect injected test wallet. The harness fails a test on any page error or
  CSP violation.

## Built with

- Runtime: React 19, `@nearpay-money/spec` 0.5.1 (contracts) + `zod`, `@nearpay-internal/ui` 0.5.0 (NearPay design system),
  `@simplewebauthn/browser` (passkeys), `@hot-labs/near-connect` (NEAR wallets, NEP-413), `uqr` (QR codes),
  Cloudflare Turnstile (sign-up only).
- Development: Vite 5 (esbuild JSX), TypeScript, Vitest (+ coverage-v8), Playwright, Biome.
- Licence: Apache-2.0 (`LICENSE`).

Code and documentation are written with AI assistance (Claude) under human direction and review. Built for the NEAR Hackathon (Nov 2026).
