# Terminology

Words this app uses, and how they differ from common monitoring systems such as CloudWatch.

## Metric

In this app, a **metric** is the named number a job writes after a reduction. The stored name is the whole identity of that number: it encodes both **what** was reduced and **how**.

Examples:

| Metric name | What was reduced | How |
|-------------|------------------|-----|
| `row_count` | rows in the window | count |
| `reading_mean` | field `reading` | mean |
| `status_distinct_count` | field `status` | distinct count |

Monitors select a metric by that name. Slack Detail lines refer to the same stored name.

### Contrast with CloudWatch

CloudWatch keeps two concepts apart:

- **Metric** — the thing measured (CPUUtilization, a custom namespace metric, and so on)
- **Statistic** — how samples of that metric are summarized over a period (Average, Sum, Maximum, SampleCount, …)

A CloudWatch alarm is roughly “this metric, this statistic, this threshold.”

This app collapses those into one **metric**. There is no separate statistic on the point or on the monitor. Choosing a reduction (count of rows, mean of `reading`) both defines the number and names it. If you need both a mean and a max of the same field, that is two metrics (`reading_mean`, `reading_max`), not one metric with two statistics.

## Reduction

A **reduction** is a job setting that turns many source rows in a collection window into one number per series.

Each reduction has:

- an **aggregation** (count, sum, mean, min, max, p95, distinct count, …)
- an optional **field** (required for everything except count; count is always rows)
- a **metric name** (today derived automatically: `row_count`, or `{field}_{aggregation}`)

“Reduction” is the configuration and the collection-time step. “Metric” is the named result that is stored and monitored.

## Aggregation

**Aggregation** is the operator inside a reduction: count, sum, mean, and so on. It is not a separate user-facing object on the time series. It only appears when defining the reduction and when deriving the metric name.

In everyday speech, reduction and aggregation overlap. In this codebase, prefer:

- **reduction** for the job config row and the “many rows → one value” step
- **aggregation** for the operator on that row

## Field

A **field** is a scalar attribute on a source row (for example `reading` or `status`). Count does not use a field. Distinct count and the numeric aggregations do.

## Tags and series

**Tags** are string key-value labels on a point. Jobs can set **static tags** (fixed on every write) and **dynamic tags** (one series per distinct source value for chosen fields).

A **series** is one job + one metric + one exact tag set. Two jobs never share a series, even with the same metric name and tags. Dynamic tags split one job into several series in the same run.

## Point

A **point** is one immutable sample: time, job, metric name, tags, value, and optional link to the run that produced it. One successful run writes one point per series for each reduction.

## Window (collection)

A job’s **window** is the half-open time range of source rows a run reduces. It is not a monitor clock. After a successful run, points are stamped with the window end. Slack’s Window line reports the collection windows of the consecutive points that decided an alert transition.

## Job

A **job** (collection job) is a scheduled query against a **connection**, with a window mode, reductions, tags, and a schedule. Jobs are the only writers of points. Monitors never query the original source.

## Monitor

A **monitor** watches one or more jobs for one metric, with an optional **tag filter**, a **threshold**, and **consecutive points**. Evaluation uses the latest stored points for each series: alert when the newest N values are all at or above the threshold (GTE). There is no separate evaluation time window today.

Monitor **state** for a series is OK or ALERT. **Severity**, **Team**, and **Manual URL** are optional metadata; Slack includes Manual URL as **URL** when set, and does not include Severity or Team.

## Related reading

- Job window modes, reductions, and dynamic tags: [`../inspection-notes.md`](../inspection-notes.md)
- Broader reduction vs aggregation vocabulary: [`../concepts/reduction_and_aggregation.md`](../concepts/reduction_and_aggregation.md)
