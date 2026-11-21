# Meridian

Meridian is an alerting system: it attaches to data sources on one end and reports incidents and their resolution on the other — primarily as alert webhook payloads (open / update / resolve). Direct Slack delivery is a secondary option when you want channel posts without a webhook consumer.

The name fits that job. A meridian is a reference line — the threshold between quiet and page — and a pathway that carries signal from source to sink. An alert is the culmination: not every reading, only the moments that become an incident.

Local package and Compose project still use `p2v3`; the public product name is Meridian.

## Stack

- Next.js (App Router) + TypeScript + Tailwind / shadcn
- PostgreSQL with TimescaleDB (config + points)
- Drizzle ORM
- In-process scheduler
- First source connector: DynamoDB

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- Compose starts TimescaleDB (`5433`) and DynamoDB Local (`8000`). The app is `npm run dev`, not Compose.
- `npm test` needs Compose Postgres and `DATABASE_URL` in `.env`.
- More detail: [docs/how-to/user-guide-v1.md](docs/how-to/user-guide-v1.md)

## Docs

| Path | Contents |
|------|----------|
| [docs/how-to/](docs/how-to/) | Run the app; inspect config and points with SQL |
| [docs/design/](docs/design/) | Product design, data model, as-built wiring |
| [docs/design/conceptual/meridian-high-level-system-view.md](docs/design/conceptual/meridian-high-level-system-view.md) | High-level system view (sources → Meridian → incidents) |
| [docs/adr/](docs/adr/) | Architecture decisions |
| [docs/concepts/](docs/concepts/) | Reduction and aggregation |
| [docs/slack/](docs/slack/) | Slack incoming webhook setup (secondary notify path) |

## License

MIT — see [LICENSE](LICENSE).
