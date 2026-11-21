# As-built implementation

What exists in the codebase today (through alert-webhook / C3 emit). Consumer-facing shape: [`../conceptual/meridian-high-level-system-view.md`](../conceptual/meridian-high-level-system-view.md).

For product words (metric, series, window), see [`../terminology.md`](../terminology.md).

## 1. Process and system boundaries

```mermaid
flowchart TB
  subgraph host [One Node process: Next.js]
    UI["App Router UI<br/>src/app/*"]
    Inst["instrumentation.ts"]
    Loop["scheduler/loop.ts<br/>setInterval → runDueJobs"]
    Store["db/store.ts + schema"]
    Mon["monitor/*"]
    Conn["sources/dynamodb/*"]
  end

  subgraph docker [docker-compose]
    PG[(TimescaleDB :5433)]
    DDBLocal[(DynamoDB Local :8000)]
  end

  Slack[[Slack Incoming Webhook]]
  AlertWH[[Alert webhook / C3 consumer]]
  DDBReal[[AWS DynamoDB optional]]

  Inst --> Loop
  UI --> Store
  UI -->|Run now / Collect now| Loop
  Loop --> Conn
  Loop --> Store
  Loop --> Mon
  Store --> PG
  Conn --> DDBLocal
  Conn --> DDBReal
  Mon -->|postSlack| Slack
  Mon -->|postC3Alert| AlertWH
```

Everything runs in-process with the Next server. No separate worker, queue, or metrics DB.

## 2. Module map (`src/`)

```mermaid
flowchart LR
  subgraph app [src/app — HTTP / RSC]
    ConnPages[connections/*]
    JobPages[jobs/*]
    MonPages[monitors/*]
  end

  subgraph domain [Domain modules]
    Store[db/store.ts]
    Sch[scheduler/run-due.ts]
    Win[scheduler/window.ts]
    Cron[scheduler/cron.ts]
    Eval[monitor/evaluate.ts]
    Msg[monitor/message.ts]
    Slack[monitor/slack.ts]
    C3[monitor/c3.ts]
    Sel[monitor/selection.ts]
    DDB[sources/dynamodb/connector.ts]
    Items[sources/dynamodb/items.ts]
  end

  ConnPages --> Store
  JobPages --> Store
  JobPages --> Sch
  MonPages --> Store
  MonPages --> Sel
  Sch --> Win
  Sch --> Cron
  Sch --> DDB
  Sch --> Store
  Sch --> Eval
  DDB --> Items
  Eval --> Msg
  Eval --> Slack
  Eval --> C3
  Eval --> Store
```

| Area | Role |
|------|------|
| `src/app/*` | Pages, forms, server actions |
| `src/db/*` | Schema, Drizzle client, CRUD |
| `src/scheduler/*` | Due ticks, windows, cron, retries |
| `src/sources/dynamodb/*` | Only connector implementation |
| `src/monitor/*` | Evaluate series, Slack text, C3 alert webhook, job-picker helpers |

## 3. Connector boundary

```mermaid
flowchart TB
  RD["run-due.ts"]
  Reg["ConnectorRegistry<br/>Map&lt;sourceType, SourceConnector&gt;"]
  IF["SourceConnector.run(SourceRunContext)<br/>→ SourcePoint[]"]
  Dyn["createDynamoConnector()"]
  Other["other sourceType<br/>→ no connector → fail / skip"]

  RD --> Reg
  Reg --> IF
  IF --> Dyn
  Reg -.-> Other
```

`scheduler/source.ts` defines the contract. Today only `"dynamodb"` is registered (from `loop.ts` and tests).

## 4. Persistence

Full table/column/JSON reference: [`../data-model.md`](../data-model.md).

```mermaid
erDiagram
  connections ||--o{ jobs : has
  jobs ||--o{ reductions : has
  jobs ||--o{ runs : has
  jobs ||--o{ points : writes
  runs ||--o{ points : runId
  monitors ||--o{ monitor_jobs : links
  jobs ||--o{ monitor_jobs : linked
  monitors ||--o{ monitor_states : per_series
  monitors ||--o{ notifications : pages
```

Config: `connections`, `jobs`, `reductions`, `monitors`, `monitor_jobs`  
Runtime: `runs`, `points`, `monitor_states`, `notifications`

Migrations live under `drizzle/`. Local DB is `docker-compose.yml` (TimescaleDB + DynamoDB Local).

## 5. Runtime call chain (one successful collect)

```mermaid
flowchart TD
  A["instrumentation → startScheduler"] --> B["runDueJobs / runJobNow"]
  B --> C["computeWindow"]
  C --> D["createRun"]
  D --> E["connector.run"]
  E --> F["queryPartitionItems + reduceSnapshots"]
  F --> G["writePoint × N"]
  G --> H["evaluateMonitors"]
  H --> I{"state change + can page?"}
  I -->|Slack| J["slackText → postSlack<br/>+ insert notifications"]
  I -->|Alert webhook| J2["postC3Alert<br/>+ insert notifications"]
  I -->|no| K["update monitor_states only"]
  J --> K
  J2 --> K
```

## 6. UI routes

```mermaid
flowchart TB
  Home["/"]
  CL["/connections"]
  CN["/connections/new"]
  CE["/connections/[id]/edit"]
  JL["/jobs"]
  JN["/jobs/new"]
  JD["/jobs/[id]"]
  JE["/jobs/[id]/edit"]
  JC["/jobs/[id]/copy"]
  ML["/monitors"]
  MN["/monitors/new"]
  MD["/monitors/[id]"]
  ME["/monitors/[id]/edit"]

  Home --- CL
  Home --- JL
  Home --- ML
  CL --- CN
  CL --- CE
  JL --- JN
  JL --- JD
  JD --- JE
  JD --- JC
  ML --- MN
  ML --- MD
  MD --- ME
```

Manual triggers: job **Run now** (`jobs/run-now-action.ts` → `runJobNow`); monitors can trigger collect through the same scheduler path.

## 7. Inside vs outside

| Inside the Next process | Outside |
|-------------------------|---------|
| App Router UI + server actions | Browser |
| In-process scheduler loop | — |
| Drizzle / `store` | TimescaleDB container |
| DynamoDB connector | DynamoDB Local or AWS |
| `postSlack` HTTP client | Slack incoming webhook URL (Slack notify mode) |
| `postC3Alert` HTTP client | Monitor alert-webhook URL (C3 **0.3** POST); optional `P8_ALERT_URL` only prefills the default on new monitors |
| Vitest against real DB | — |

Not built: separate worker, undelivered-alert board, non-Dynamo connectors, email, multi-tenant auth.
