import type { Tags } from "./schema";

export const severityLevels = ["critical", "warning", "info"] as const;
export type SeverityLevel = (typeof severityLevels)[number];

export const severityModes = ["unset", "fixed", "from_tag"] as const;
export type SeverityMode = (typeof severityModes)[number];

export const severityMissingModes = ["omit", "fixed"] as const;
export type SeverityMissingMode = (typeof severityMissingModes)[number];

export type SeverityConfig =
  | { mode: "unset" }
  | { mode: "fixed"; fixed: SeverityLevel }
  | {
      mode: "from_tag";
      tag: string;
      map: Record<string, SeverityLevel>;
      whenMissing: SeverityMissingMode;
      /** Used when whenMissing is "fixed". */
      fixed?: SeverityLevel;
    };

export function isSeverityLevel(value: unknown): value is SeverityLevel {
  return typeof value === "string" && severityLevels.includes(value as SeverityLevel);
}

/** Coerce stored or legacy values into a config. Never throws. */
export function normalizeSeverityConfig(input: unknown): SeverityConfig {
  if (input == null) {
    return { mode: "unset" };
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return { mode: "unset" };
    }
    const level = canonicalizeLevel(trimmed);
    return level ? { mode: "fixed", fixed: level } : { mode: "unset" };
  }
  if (typeof input !== "object") {
    return { mode: "unset" };
  }
  const row = input as Record<string, unknown>;
  const mode = row.mode;
  if (mode === "unset" || mode === "" || mode == null) {
    return { mode: "unset" };
  }
  if (mode === "fixed") {
    const fixed = canonicalizeLevel(row.fixed);
    return fixed ? { mode: "fixed", fixed } : { mode: "unset" };
  }
  if (mode === "from_tag") {
    const tag = String(row.tag ?? "").trim();
    const map = normalizeMap(row.map);
    const whenMissing: SeverityMissingMode = row.whenMissing === "fixed" ? "fixed" : "omit";
    const fixed = canonicalizeLevel(row.fixed);
    if (!tag || Object.keys(map).length === 0) {
      return { mode: "unset" };
    }
    if (whenMissing === "fixed" && !fixed) {
      return { mode: "from_tag", tag, map, whenMissing: "omit" };
    }
    return whenMissing === "fixed" && fixed
      ? { mode: "from_tag", tag, map, whenMissing, fixed }
      : { mode: "from_tag", tag, map, whenMissing: "omit" };
  }
  return { mode: "unset" };
}

/** Validate config for save. */
export function parseSeverityConfig(input: unknown): { error: string } | { config: SeverityConfig } {
  if (input == null || input === "") {
    return { config: { mode: "unset" } };
  }
  if (typeof input === "string") {
    try {
      return parseSeverityConfig(JSON.parse(input));
    } catch {
      const trimmed = input.trim();
      if (!trimmed) {
        return { config: { mode: "unset" } };
      }
      const level = canonicalizeLevel(trimmed);
      if (!level) {
        return { error: "Severity must be critical, warning, or info." };
      }
      return { config: { mode: "fixed", fixed: level } };
    }
  }
  if (typeof input !== "object") {
    return { error: "Severity could not be read." };
  }
  const row = input as Record<string, unknown>;
  const mode = String(row.mode ?? "unset").trim();
  if (mode === "unset") {
    return { config: { mode: "unset" } };
  }
  if (mode === "fixed") {
    const fixed = canonicalizeLevel(row.fixed);
    if (!fixed) {
      return { error: "Choose a severity: critical, warning, or info." };
    }
    return { config: { mode: "fixed", fixed } };
  }
  if (mode === "from_tag") {
    const tag = String(row.tag ?? "").trim();
    if (!tag) {
      return { error: "A from-tag severity needs a tag name." };
    }
    const map = normalizeMap(row.map);
    if (Object.keys(map).length === 0) {
      return { error: "Map at least one tag value to critical, warning, or info." };
    }
    const whenMissing: SeverityMissingMode = row.whenMissing === "fixed" ? "fixed" : "omit";
    if (whenMissing === "fixed") {
      const fixed = canonicalizeLevel(row.fixed);
      if (!fixed) {
        return { error: "Choose a fallback severity when the tag is missing." };
      }
      return { config: { mode: "from_tag", tag, map, whenMissing, fixed } };
    }
    return { config: { mode: "from_tag", tag, map, whenMissing: "omit" } };
  }
  return { error: "Choose how severity is set." };
}

/** Resolve page severity for a firing/resolved series. */
export function resolveSeverity(config: SeverityConfig, tags: Tags): SeverityLevel | null {
  const normalized = normalizeSeverityConfig(config);
  if (normalized.mode === "unset") {
    return null;
  }
  if (normalized.mode === "fixed") {
    return normalized.fixed;
  }
  const raw = tags[normalized.tag];
  if (typeof raw === "string" && raw.length > 0) {
    const direct = normalized.map[raw];
    if (direct) {
      return direct;
    }
    const lower = raw.toLowerCase();
    for (const [key, value] of Object.entries(normalized.map)) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
  }
  if (normalized.whenMissing === "fixed" && normalized.fixed) {
    return normalized.fixed;
  }
  return null;
}

export function formatSeverityConfig(config: SeverityConfig): string {
  const normalized = normalizeSeverityConfig(config);
  if (normalized.mode === "unset") {
    return "None";
  }
  if (normalized.mode === "fixed") {
    return normalized.fixed;
  }
  const pairs = Object.entries(normalized.map)
    .map(([from, to]) => `${from}→${to}`)
    .join(", ");
  const missing =
    normalized.whenMissing === "fixed" && normalized.fixed
      ? `; missing→${normalized.fixed}`
      : "; missing omitted";
  return `from ${normalized.tag}: ${pairs}${missing}`;
}

export function defaultSeverityMap(): Record<string, SeverityLevel> {
  return { critical: "critical", warning: "warning", info: "info" };
}

function canonicalizeLevel(value: unknown): SeverityLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return isSeverityLevel(trimmed) ? trimmed : null;
}

function normalizeMap(input: unknown): Record<string, SeverityLevel> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const map: Record<string, SeverityLevel> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const from = key.trim();
    const to = canonicalizeLevel(value);
    if (!from || !to) {
      continue;
    }
    map[from] = to;
  }
  return map;
}
