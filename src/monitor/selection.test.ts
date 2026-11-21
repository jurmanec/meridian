import { expect, test } from "vitest";
import { applySelection, differingTags, sharedMetrics, type JobOption } from "./selection";

const jobs: JobOption[] = [
  {
    id: "east",
    name: "checkout-errors-us-east",
    metrics: ["checkout_errors_total", "checkout_error_duration_p95"],
    staticTags: { env: "prod", team: "payments", region: "us-east-1" },
  },
  {
    id: "west",
    name: "checkout-errors-us-west",
    metrics: ["checkout_errors_total", "checkout_error_duration_p95"],
    staticTags: { env: "prod", team: "payments", region: "us-west-2" },
  },
  {
    id: "eu",
    name: "checkout-latency-eu",
    metrics: ["checkout_latency_p95"],
    staticTags: { env: "prod", team: "payments", region: "eu-west-1" },
  },
];

test("tag filters find jobs and warn when the metric is missing", () => {
  const result = applySelection(jobs, {
    tags: [
      { key: "team", match: "equals", value: "payments" },
      { key: "env", match: "equals", value: "prod" },
      { key: "region", match: "regex", value: "us-.*" },
    ],
    jobName: "checkout",
    metricName: "checkout_errors_total",
  });

  expect(result.error).toBe("");
  expect(result.matches.map((match) => ({ id: match.job.id, warning: match.warning }))).toEqual([
    { id: "east", warning: "" },
    { id: "west", warning: "" },
  ]);
});

test("a tag match that misses the metric is a warning, and a metric-only filter omits it", () => {
  const warned = applySelection(jobs, {
    tags: [{ key: "region", match: "regex", value: "eu-.*" }],
    jobName: "",
    metricName: "checkout_errors_total",
  });
  expect(warned.matches).toEqual([{ job: jobs[2], warning: "Does not write checkout_errors_total." }]);

  const metricOnly = applySelection(jobs, {
    tags: [],
    jobName: "",
    metricName: "checkout_errors_total",
  });
  expect(metricOnly.matches.map((match) => match.job.id)).toEqual(["east", "west"]);
});

test("an invalid pattern is rejected", () => {
  const result = applySelection(jobs, {
    tags: [{ key: "region", match: "regex", value: "(" }],
    jobName: "",
    metricName: "",
  });
  expect(result.error).toMatch(/region/);
  expect(result.matches).toEqual([]);
});

test("shared metrics and differing tags come from the checked jobs", () => {
  expect(sharedMetrics([jobs[0], jobs[1]])).toEqual(["checkout_errors_total", "checkout_error_duration_p95"]);
  expect(sharedMetrics([jobs[0], jobs[2]])).toEqual([]);
  expect(differingTags([jobs[0], jobs[1]])).toEqual({ region: ["us-east-1", "us-west-2"] });
});
