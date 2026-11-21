import { expect, test } from "vitest";
import { computeWindow } from "./window";

const now = new Date("2026-11-13T16:00:00.000Z");

test("the first run looks back the safety maximum", () => {
  expect(computeWindow({ now, maxLookbackSeconds: 86_400, lastSuccessEnd: null })).toEqual({
    start: new Date("2026-11-12T16:00:00.000Z"),
    end: now,
  });
});

test("a later run starts at the last success", () => {
  const lastSuccessEnd = new Date("2026-11-13T15:00:00.000Z");
  expect(computeWindow({ now, maxLookbackSeconds: 86_400, lastSuccessEnd })).toEqual({
    start: lastSuccessEnd,
    end: now,
  });
});

test("a gap longer than the safety maximum drops the older rows", () => {
  const lastSuccessEnd = new Date("2026-11-11T16:00:00.000Z");
  expect(computeWindow({ now, maxLookbackSeconds: 86_400, lastSuccessEnd })).toEqual({
    start: new Date("2026-11-12T16:00:00.000Z"),
    end: now,
  });
});

test("a fixed lookback ignores the last success", () => {
  const lastSuccessEnd = new Date("2026-11-13T15:00:00.000Z");
  expect(computeWindow({ now, mode: "fixed_lookback", maxLookbackSeconds: 3600, lastSuccessEnd })).toEqual({
    start: new Date("2026-11-13T15:00:00.000Z"),
    end: now,
  });
});

test("a calendar window is the last completed utc bucket", () => {
  const during = new Date("2026-11-13T16:07:00.000Z");
  expect(computeWindow({ now: during, mode: "calendar", maxLookbackSeconds: 3600, lastSuccessEnd: null })).toEqual({
    start: new Date("2026-11-13T15:00:00.000Z"),
    end: new Date("2026-11-13T16:00:00.000Z"),
  });
});
