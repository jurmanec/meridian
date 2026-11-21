import { expect, test } from "vitest";
import {
  defaultSeverityMap,
  formatSeverityConfig,
  normalizeSeverityConfig,
  parseSeverityConfig,
  resolveSeverity,
} from "./severity";

test("legacy strings become fixed or unset", () => {
  expect(normalizeSeverityConfig("")).toEqual({ mode: "unset" });
  expect(normalizeSeverityConfig("critical")).toEqual({ mode: "fixed", fixed: "critical" });
  expect(normalizeSeverityConfig("WARNING")).toEqual({ mode: "fixed", fixed: "warning" });
});

test("parse rejects empty from_tag maps", () => {
  const parsed = parseSeverityConfig({ mode: "from_tag", tag: "alarm_severity", map: {} });
  expect("error" in parsed).toBe(true);
});

test("resolve fixed and from_tag with map and whenMissing", () => {
  expect(resolveSeverity({ mode: "unset" }, { alarm_severity: "critical" })).toBeNull();
  expect(resolveSeverity({ mode: "fixed", fixed: "warning" }, {})).toBe("warning");

  const fromTag = {
    mode: "from_tag" as const,
    tag: "alarm_severity",
    map: { critical: "critical" as const, warning: "warning" as const },
    whenMissing: "omit" as const,
  };
  expect(resolveSeverity(fromTag, { alarm_severity: "critical" })).toBe("critical");
  expect(resolveSeverity(fromTag, { alarm_severity: "CRITICAL" })).toBe("critical");
  expect(resolveSeverity(fromTag, {})).toBeNull();

  const withFallback = {
    ...fromTag,
    whenMissing: "fixed" as const,
    fixed: "info" as const,
  };
  expect(resolveSeverity(withFallback, {})).toBe("info");
  expect(resolveSeverity(withFallback, { alarm_severity: "unknown" })).toBe("info");
});

test("formatSeverityConfig summarizes modes", () => {
  expect(formatSeverityConfig({ mode: "unset" })).toBe("None");
  expect(formatSeverityConfig({ mode: "fixed", fixed: "critical" })).toBe("critical");
  expect(
    formatSeverityConfig({
      mode: "from_tag",
      tag: "alarm_severity",
      map: defaultSeverityMap(),
      whenMissing: "omit",
    }),
  ).toContain("from alarm_severity:");
});
