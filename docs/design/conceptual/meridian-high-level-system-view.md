# Meridian — high-level system view

Matches the public framing in the root [README](../../../README.md): sources on one end, incidents on the other; alert webhook payloads as the primary output; Slack secondary. No timeseries jargon in the consumer story.

![Meridian high-level system view](./Meridian_High_Level_System_View.svg)

## Same view (Mermaid)

```mermaid
flowchart LR
  subgraph Sources["Data sources (connections)"]
    DDB[DynamoDB]
    Other[Other sources later]
  end

  subgraph Meridian["Meridian — pathway / threshold"]
    Collect[Collect from sources]
    Eval[Evaluate thresholds]
    Lifecycle[Open / update / resolve]
    Collect --> Eval --> Lifecycle
  end

  subgraph Incidents["Incidents"]
    WH["Alert webhook payloads<br/>FIRING · UPDATE · RESOLVED<br/>(primary)"]
    Slack["Slack (secondary option)"]
  end

  Sources --> Meridian --> WH
  Meridian -.-> Slack
```

## Why this shape

- **Left:** connections attach Meridian to data sources.
- **Center:** Meridian is the pathway and the reference line (threshold between quiet and page). Collect, evaluate, then open / update / resolve — not every reading becomes an incident.
- **Right:** primary sink is the **alert webhook payload**; Slack is an optional secondary notify path.
