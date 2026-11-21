# How to run Meridian

Commands are run from the repo root. The app does not start from Compose. Compose starts the local stores. `npm run dev` starts the app and the in-process scheduler.

## First time

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

`.env.example` sets `DATABASE_URL` to `postgres://p2v3:p2v3@localhost:5433/p2v3`. The app refuses to start without `DATABASE_URL`. Each monitor chooses **Notify via**: **Alert webhook** (C3 **0.3** POST — primary) or Slack (incoming webhook — secondary). Optional `P8_ALERT_URL` (for example `http://127.0.0.1:8787`) prefills the alert-webhook URL on new monitors; it does not enable a second sink.

Open [http://localhost:3000](http://localhost:3000). If port 3000 is already taken, stop the other process or run `npx next dev -p 3010`.

`npm run db:migrate` applies pending migrations. Run it again after a pull that adds a file under `drizzle/`.

## Start

```bash
docker compose up -d
npm run dev
```

| Process | What it is | Port |
|---|---|---|
| `db` | PostgreSQL with TimescaleDB. Jobs, monitors, runs, and points. | 5433 |
| `dynamodb` | DynamoDB Local, in memory. The first source type. | 8000 |
| `npm run dev` | The app. Enabled jobs run on a one-second tick while this process is up. | 3000 |

Postgres data stays in the `p2v3-pg` volume. DynamoDB Local drops its tables when that container stops. Recreate a table before a job can read it again.

Add a connection and a job in the UI after the app is running. Nothing is seeded at startup.

## Stop

Stop the app with Ctrl-C in the `npm run dev` terminal. That stops the scheduler. Saved jobs stay enabled and resume on the next start.

Then stop the stores:

```bash
docker compose down
```

That removes the containers and keeps the Postgres volume. `docker compose stop` stops them without removing the containers.

`docker compose down -v` deletes the Postgres volume. Jobs, monitors, and points are gone. DynamoDB Local was already empty.

## Checks

`npm test` needs the database from Compose, and `DATABASE_URL` in `.env`. It does not need DynamoDB Local. `npm run lint` needs neither.
