# nearpay-dashboard

> Merchant dashboard: payments, refunds (with wallet signing), invoices, subscriptions, customers, developers (keys, webhooks, events, logs), settlement, team.

| | |
|---|---|
| Group | Frontends |
| Kind | static SPA |
| Ships as | dashboard.nearpay.money |
| Owns | — (stateless) |
| Depends on (published artifacts only) | spec (public + dashboard), gateway |
| First built in | Stage 1 (step 1.3) |

## Documentation

This repo stays surgical: design docs live in [`nearpay-brain`](../nearpay-brain/README.md), not here.

- `nearpay-brain/lld/dashboard-and-console.md` — **low-level design (dev-ready; implement from this)**
- `nearpay-brain/lld/audits/dashboard-and-console.md` — audit findings already folded into the LLD
- `nearpay-brain/roadmap/development-plan.md` — stage and step this repo is built in
- `nearpay-brain/architecture/hld.md` — system design
- `nearpay-brain/architecture/repositories.md` — repo topology and dependency rules
- `nearpay-brain/architecture/api-conventions.md`
- `nearpay-brain/architecture/flows.md#4-refund-merchant-authorised`

## Layout

```
nearpay-dashboard/
├── src/
│   ├── features/
│   │   ├── customers/
│   │   ├── developers/
│   │   ├── invoices/
│   │   ├── payments/
│   │   ├── refunds/
│   │   ├── settings/
│   │   ├── settlement/
│   │   ├── subscriptions/
│   │   └── team/
│   ├── lib/
│   ├── routes/
│   └── wallets/
├── test/
│   ├── e2e/
│   └── unit/
└── .github/
    └── workflows/
```

## Status

Scaffold only. Implementation starts in **Stage 1 (step 1.3)** (`nearpay-brain/roadmap/development-plan.md`).

## Built with

Libraries are listed here as they are added (hackathon rule Q-005). Code and documentation are written with AI assistance (Claude) under human direction and review.
