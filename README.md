# nearpay-dashboard

> Merchant dashboard: payments, refunds (with wallet signing), invoices, subscriptions, customers, developers (keys, webhooks, events, logs), settlement, team.

| | |
|---|---|
| Group | Frontends |
| Kind | static SPA |
| Ships as | dashboard.nearpay.money |
| Owns | — (stateless) |
| Depends on (published artifacts only) | spec (public + dashboard), gateway |
| Roadmap phase | P1 Core payments |

## Documentation

This repo stays surgical: design docs live in [`nearpay-brain`](../nearpay-brain/README.md), not here.

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

Scaffold only. Implementation starts in phase **P1 Core payments** (`nearpay-brain/roadmap/roadmap.md`).
