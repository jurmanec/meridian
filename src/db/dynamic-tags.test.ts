import { expect, test } from "vitest";
import {
  absentConditionZeros,
  conditionTagKeys,
  normalizeDynamicTags,
  pickFromValues,
  tagValueFromPath,
  valuesAtPath,
} from "./dynamic-tags";

test("legacy string dynamic tags become field tags", () => {
  expect(normalizeDynamicTags([" asset_id ", ""])).toEqual([{ type: "field", name: "asset_id", absent: "omit" }]);
});

test("legacy highest combine becomes a priority list", () => {
  expect(
    normalizeDynamicTags([
      { type: "path", tag: "alarm_severity", path: "alarms[*].severity", combine: "highest", whenEmpty: "info" },
    ]),
  ).toEqual([
    {
      type: "path",
      tag: "alarm_severity",
      path: "alarms[*].severity",
      pick: "priority",
      priority: ["critical", "warning", "info"],
      whenEmpty: "info",
      absent: "omit",
    },
  ]);
});

test("absent condition zeros fill missing prior series", () => {
  const tags = normalizeDynamicTags([
    { type: "field", name: "asset_id", absent: "omit" },
    { type: "path", tag: "alarm_severity", path: "alarms[*].severity", pick: "first", absent: "zero" },
  ]);
  expect(conditionTagKeys(tags)).toEqual(["alarm_severity"]);
  expect(
    absentConditionZeros(
      [{ metricName: "row_count", value: 0, tags: { asset_id: "ROOM-01", status: "FAULTED" } }],
      [
        {
          metricName: "row_count",
          tags: { alarm_severity: "critical", asset_id: "ROOM-01", status: "FAULTED" },
        },
        {
          metricName: "row_count",
          tags: { alarm_severity: "warning", asset_id: "ROOM-01", status: "FAULTED" },
        },
        { metricName: "row_count", tags: { asset_id: "ROOM-01", status: "FAULTED" } },
      ],
      conditionTagKeys(tags),
    ),
  ).toEqual([
    {
      metricName: "row_count",
      tags: { alarm_severity: "critical", asset_id: "ROOM-01", status: "FAULTED" },
      value: 0,
    },
    {
      metricName: "row_count",
      tags: { alarm_severity: "warning", asset_id: "ROOM-01", status: "FAULTED" },
      value: 0,
    },
  ]);
});

test("valuesAtPath walks array wildcards", () => {
  expect(
    valuesAtPath(
      {
        alarms: [{ severity: "warning" }, { severity: "critical" }, { severity: 1 }],
      },
      "alarms[*].severity",
    ),
  ).toEqual(["warning", "critical", "1"]);
});

test("first and last pick use path order", () => {
  const values = ["foo", "bar", "baz"];
  expect(
    pickFromValues(values, {
      type: "path",
      tag: "t",
      path: "x",
      pick: "first",
      priority: [],
      whenEmpty: null,
      absent: "omit",
    }),
  ).toBe("foo");
  expect(
    pickFromValues(values, {
      type: "path",
      tag: "t",
      path: "x",
      pick: "last",
      priority: [],
      whenEmpty: null,
      absent: "omit",
    }),
  ).toBe("baz");
});

test("priority pick uses the user-ordered list", () => {
  expect(
    pickFromValues(["warning", "CRITICAL", "nope"], {
      type: "path",
      tag: "t",
      path: "x",
      pick: "priority",
      priority: ["critical", "warning", "info"],
      whenEmpty: "info",
      absent: "omit",
    }),
  ).toBe("critical");
  expect(
    pickFromValues(["123", "abc", "foo"], {
      type: "path",
      tag: "t",
      path: "x",
      pick: "priority",
      priority: ["foo", "bar"],
      whenEmpty: null,
      absent: "omit",
    }),
  ).toBe("foo");
  expect(
    pickFromValues(["123", "abc"], {
      type: "path",
      tag: "t",
      path: "x",
      pick: "priority",
      priority: ["foo", "bar"],
      whenEmpty: null,
      absent: "omit",
    }),
  ).toBeUndefined();
});

test("path tags apply the configured pick", () => {
  expect(
    tagValueFromPath(
      { alarms: [{ severity: "warning" }, { severity: "critical" }] },
      {
        type: "path",
        tag: "alarm_severity",
        path: "alarms[*].severity",
        pick: "priority",
        priority: ["critical", "warning", "info"],
        whenEmpty: "warning",
        absent: "omit",
      },
    ),
  ).toBe("critical");
});
