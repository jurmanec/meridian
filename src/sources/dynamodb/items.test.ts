import { expect, test } from "vitest";
import { cardinalityWarning, formatSortBound, itemsInWindow, metricNameFor, readPartitionKey, reduceSnapshots, sortKeyInWindow, type SnapshotItem } from "./items";

const start = new Date("2026-11-13T16:00:00.000Z");
const end = new Date("2026-11-13T16:05:00.000Z");

const items: SnapshotItem[] = [
  { pk: "ASSET-1", sk: "2026-11-13T16:00:00.000000000Z", status: "FAULTED" },
  { pk: "ASSET-1", sk: "2026-11-13T16:02:00.500000000Z", status: "FAULTED" },
  { pk: "ASSET-1", sk: "2026-11-13T16:03:00.000000000Z", status: "RUNNING" },
  { pk: "ASSET-1", sk: "2026-11-13T16:05:00.000000000Z", status: "FAULTED" },
  { pk: "ASSET-1", sk: "2026-11-13T15:59:59.999999999Z", status: "FAULTED" },
  { pk: "OTHER", sk: "2026-11-13T16:02:00.000000000Z", status: "FAULTED" },
];

test("the window includes the start and excludes the end", () => {
  expect(formatSortBound(start)).toBe("2026-11-13T16:00:00.000000000Z");
  expect(sortKeyInWindow("2026-11-13T16:00:00.000000000Z", start, end)).toBe(true);
  expect(sortKeyInWindow("2026-11-13T16:04:59.999999999Z", start, end)).toBe(true);
  expect(sortKeyInWindow("2026-11-13T16:05:00.000000000Z", start, end)).toBe(false);
  expect(sortKeyInWindow("2026-11-13T15:59:59.999999999Z", start, end)).toBe(false);
  expect(sortKeyInWindow("2026-11-13T16:02:00.500000000Z#ab12cd34", start, end)).toBe(true);
});

test("metric names come from the reduction", () => {
  expect(metricNameFor("count")).toBe("row_count");
  expect(metricNameFor("mean", "reading")).toBe("reading_mean");
  expect(metricNameFor("max", " reading ")).toBe("reading_max");
  expect(metricNameFor("distinct_count", "status")).toBe("status_distinct_count");
  expect(() => metricNameFor("sum", "")).toThrow(/field/);
});

test("a count is the rows in that partition and window", () => {
  const selected = itemsInWindow(items, "ASSET-1", start, end);
  const points = reduceSnapshots(
    selected,
    [
      { aggregation: "count", metricName: "faulted_count" },
      { aggregation: "count", metricName: "faulted_count_again" },
    ],
    [],
  );

  expect(selected.map((item) => item.sk)).toEqual([
    "2026-11-13T16:00:00.000000000Z",
    "2026-11-13T16:02:00.500000000Z",
    "2026-11-13T16:03:00.000000000Z",
  ]);
  expect(points).toEqual([
    { metricName: "faulted_count", value: 3, tags: {} },
    { metricName: "faulted_count_again", value: 3, tags: {} },
  ]);
});

test("an empty window counts as zero", () => {
  const points = reduceSnapshots([], [{ aggregation: "count", metricName: "faulted_count" }], []);
  expect(points).toEqual([{ metricName: "faulted_count", value: 0, tags: {} }]);
});

test("two reductions and a dynamic tag split the window", () => {
  const selected: SnapshotItem[] = [
    { pk: "HALL", sk: "2026-11-13T16:01:00.000000000Z", status: "FAULTED", fields: { asset_id: "CRAH-01", reading: 4 } },
    { pk: "HALL", sk: "2026-11-13T16:02:00.000000000Z", status: "FAULTED", fields: { asset_id: "CRAH-01", reading: 6 } },
    { pk: "HALL", sk: "2026-11-13T16:03:00.000000000Z", status: "RUNNING", fields: { reading: 9 } },
    { pk: "HALL", sk: "2026-11-13T16:04:00.000000000Z", status: "FAULTED", fields: { asset_id: "UPS-01", reading: "1" } },
  ];
  const points = reduceSnapshots(
    selected,
    [
      { aggregation: "count", metricName: "faulted_count" },
      { aggregation: "sum", metricName: "reading_sum", field: "reading" },
    ],
    ["asset_id"],
  );
  expect(points).toEqual([
    { metricName: "faulted_count", value: 2, tags: { asset_id: "CRAH-01" } },
    { metricName: "reading_sum", value: 10, tags: { asset_id: "CRAH-01" } },
    { metricName: "faulted_count", value: 1, tags: {} },
    { metricName: "reading_sum", value: 9, tags: {} },
    { metricName: "faulted_count", value: 1, tags: { asset_id: "UPS-01" } },
    { metricName: "reading_sum", value: 1, tags: { asset_id: "UPS-01" } },
  ]);
});

test("an empty numeric field still writes zero", () => {
  const points = reduceSnapshots(
    [{ pk: "HALL", sk: "2026-11-13T16:01:00.000000000Z", status: "RUNNING", fields: {} }],
    [
      { aggregation: "mean", metricName: "reading_mean", field: "reading" },
      { aggregation: "p95", metricName: "reading_p95", field: "reading" },
      { aggregation: "distinct_count", metricName: "codes", field: "code" },
    ],
    [],
  );
  expect(points.map((point) => point.value)).toEqual([0, 0, 0]);
});

test("a path dynamic tag folds alarm severities onto the series", () => {
  const selected: SnapshotItem[] = [
    {
      pk: "HALL",
      sk: "2026-11-13T16:01:00.000000000Z",
      status: "FAULTED",
      fields: { asset_id: "CRAH-01" },
      document: {
        pk: "HALL",
        asset_id: "CRAH-01",
        alarms: [{ severity: "warning" }, { severity: "critical" }],
      },
    },
    {
      pk: "HALL",
      sk: "2026-11-13T16:02:00.000000000Z",
      status: "FAULTED",
      fields: { asset_id: "CRAH-01" },
      document: {
        pk: "HALL",
        asset_id: "CRAH-01",
        alarms: [{ severity: "warning" }],
      },
    },
  ];
  const points = reduceSnapshots(
    selected,
    [{ aggregation: "count", metricName: "row_count" }],
    [
      { type: "field", name: "asset_id" },
      {
        type: "path",
        tag: "alarm_severity",
        path: "alarms[*].severity",
        pick: "priority",
        priority: ["critical", "warning", "info"],
        whenEmpty: "warning",
      },
    ],
  );
  expect(points).toEqual([
    { metricName: "row_count", value: 1, tags: { alarm_severity: "critical", asset_id: "CRAH-01" } },
    { metricName: "row_count", value: 1, tags: { alarm_severity: "warning", asset_id: "CRAH-01" } },
  ]);
});

test("more than ten series in a window is a warning", () => {
  expect(cardinalityWarning(10)).toBe("");
  expect(cardinalityWarning(11)).toBe("High cardinality: 11 series in this window.");
});

test("a job without a partition key cannot run", () => {
  expect(() => readPartitionKey({})).toThrow(/partition key/);
  expect(readPartitionKey({ partitionKey: " ASSET-1 " })).toBe("ASSET-1");
});
