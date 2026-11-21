# Telemetry Pipeline: Reductions and Aggregations

## Scenario

Consider a table of telemetry data. Each row looks roughly like this:

```json
{
  "pk": "ROOM-01",
  "sk": "2026-11-14T00:00:08.715767795Z",
  "alarms": [
    {
      "code": "ROOM_TEMP_HIGH",
      "message": "Hall temperature above limit",
      "severity": "warning"
    }
  ],
  "asset_id": "ROOM-01",
  "asset_type": "room",
  "hall_id": "HALL-01",
  "ingested_at": 1794587760,
  "reading": 32,
  "schema_version": 3,
  "site_id": "SITE-01",
  "status": "FAULTED",
  "timestamp": "2026-11-14T00:00:08.715767795Z",
  "unit": "C"
}
```

The partition key (`pk`) is either `ROOM-01` or `CRAH-01`.

Two collection jobs periodically query the table over a time range, count the rows where `status = FAULTED`, and write the resulting counts as time-series points into an internal database. These collection steps are reductions.

A monitor is then configured to look at both the `ROOM-01` faulted-count series and the `CRAH-01` faulted-count series together. It alerts whenever the combined value over the evaluation period is greater than 0.

## Question

What should the monitor’s combined evaluation step be called? Is it an aggregation?

## Answer

**Yes — the combined evaluation step is an aggregation** (specifically, a reduction over the two already-reduced series).

### Pipeline breakdown

1. **Collection jobs (first-stage reductions)**  
   Each job reads many raw telemetry rows in a time window and produces a single number: the count of rows where `status = FAULTED` for one asset (`ROOM-01` or `CRAH-01`).  
   This is a classic reduction: many rows → one summary value, stored as a time-series point.

2. **Monitor evaluation (second-stage aggregation)**  
   The monitor takes the two time series produced by those reductions and combines them over an evaluation window, then checks whether the result is greater than zero.  
   A typical expression looks like:
   ```
   sum(room_faulted_count) + sum(crah_faulted_count) > 0
   ```
   or
   ```
   sum(faulted_count{pk=~"ROOM-01|CRAH-01"}) > 0
   ```

   This is also a reduction/aggregation:
   - It collapses multiple series (or multiple points inside a window) into one value.
   - The usual operator is `sum` (though `max`, logical OR, etc. are also possible).
   - In monitoring systems this is routinely described as an aggregation expression evaluated by the alerting engine.

### Summary of terminology

| Step                        | Common labels                          | Reason |
|-----------------------------|----------------------------------------|--------|
| Collection jobs             | Reduction, aggregation, metric recording | Many raw rows → one count per asset |
| Monitor combining both counts | Aggregation (second-stage reduction)  | Two series → one combined value for the alert condition |

In short:
- The collection jobs are reductions.
- The monitor’s combined evaluation is an aggregation of those reduced series.

Both steps are reductions in the broad sense; the monitor step is simply the higher-level aggregation that operates on the outputs of the first reductions.
