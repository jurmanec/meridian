export const pathPickModes = ["first", "last", "priority"] as const;
export type PathPickMode = (typeof pathPickModes)[number];

export const absentModes = ["omit", "zero"] as const;
export type AbsentMode = (typeof absentModes)[number];

export type FieldDynamicTag = {
  type: "field";
  name: string;
  /** omit = identity (no invented point). zero = condition (write 0 when combination missing). */
  absent: AbsentMode;
};

export type PathDynamicTag = {
  type: "path";
  tag: string;
  path: string;
  pick: PathPickMode;
  /** Highest priority first. Used when pick is "priority". */
  priority: string[];
  /** Literal when the pick finds nothing. Omit the tag when null. */
  whenEmpty: string | null;
  /** omit = identity. zero = condition; missing combinations get value 0 after a successful run. */
  absent: AbsentMode;
};

export type DynamicTag = FieldDynamicTag | PathDynamicTag;

export function dynamicTagKey(tag: DynamicTag): string {
  return tag.type === "field" ? tag.name : tag.tag;
}

export function conditionTagKeys(tags: DynamicTag[]): string[] {
  return tags.filter((tag) => tag.absent === "zero").map(dynamicTagKey);
}

/** Synthetic zeros for prior series that include a condition tag and were not written this run. */
export function absentConditionZeros(
  written: { metricName: string; tags: Record<string, string>; value: number }[],
  prior: { metricName: string; tags: Record<string, string> }[],
  conditionKeys: string[],
): { metricName: string; tags: Record<string, string>; value: number }[] {
  if (conditionKeys.length === 0) {
    return [];
  }
  const seen = new Set(written.map((point) => seriesIdentity(point.metricName, point.tags)));
  const extras: { metricName: string; tags: Record<string, string>; value: number }[] = [];
  const added = new Set<string>();
  for (const row of prior) {
    const tags = sortedTags(row.tags);
    if (!conditionKeys.some((key) => typeof tags[key] === "string" && tags[key].length > 0)) {
      continue;
    }
    const id = seriesIdentity(row.metricName, tags);
    if (seen.has(id) || added.has(id)) {
      continue;
    }
    added.add(id);
    extras.push({ metricName: row.metricName, tags, value: 0 });
  }
  return extras;
}

function seriesIdentity(metricName: string, tags: Record<string, string>): string {
  return JSON.stringify({ metricName, tags: sortedTags(tags) });
}

function sortedTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeDynamicTags(input: unknown): DynamicTag[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const tags: DynamicTag[] = [];
  for (const entry of input) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) {
        tags.push({ type: "field", name, absent: "omit" });
      }
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (row.type === "path" || (typeof row.path === "string" && row.path.length > 0)) {
      const tag = String(row.tag ?? "").trim();
      const path = String(row.path ?? "").trim();
      if (!tag || !path) {
        continue;
      }
      tags.push(normalizePathTag(tag, path, row));
      continue;
    }
    const name = String(row.name ?? row.field ?? "").trim();
    if (name) {
      tags.push({ type: "field", name, absent: readAbsent(row.absent) });
    }
  }
  return tags;
}

function normalizePathTag(tag: string, path: string, row: Record<string, unknown>): PathDynamicTag {
  const legacyHighest = row.combine === "highest";
  let pick: PathPickMode = "first";
  if (pathPickModes.includes(row.pick as PathPickMode)) {
    pick = row.pick as PathPickMode;
  } else if (legacyHighest) {
    pick = "priority";
  }

  let priority = readPriority(row.priority);
  if (priority.length === 0 && (pick === "priority" || legacyHighest)) {
    priority = ["critical", "warning", "info"];
  }

  return {
    type: "path",
    tag,
    path,
    pick,
    priority,
    whenEmpty: readWhenEmpty(row.whenEmpty),
    absent: readAbsent(row.absent),
  };
}

function readAbsent(value: unknown): AbsentMode {
  return value === "zero" ? "zero" : "omit";
}

function readPriority(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = String(entry ?? "").trim();
    if (text) {
      out.push(text);
    }
  }
  return out;
}

function readWhenEmpty(value: unknown): string | null {
  if (value === null || value === undefined || value === "none" || value === "") {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

export function sameDynamicTags(left: unknown, right: unknown): boolean {
  const a = normalizeDynamicTags(left)
    .map((tag) => JSON.stringify(tag))
    .sort();
  const b = normalizeDynamicTags(right)
    .map((tag) => JSON.stringify(tag))
    .sort();
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

export function pickFromValues(values: string[], tag: PathDynamicTag): string | undefined {
  if (values.length === 0) {
    return tag.whenEmpty ?? undefined;
  }
  if (tag.pick === "first") {
    return values[0];
  }
  if (tag.pick === "last") {
    return values[values.length - 1];
  }
  const found = new Map<string, string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (key && !found.has(key)) {
      found.set(key, value.trim());
    }
  }
  for (const preferred of tag.priority) {
    const key = preferred.trim().toLowerCase();
    if (found.has(key)) {
      return preferred.trim();
    }
  }
  return tag.whenEmpty ?? undefined;
}

/** Resolve paths like `alarms[*].severity` or `asset_id` against a JSON document. */
export function valuesAtPath(document: Record<string, unknown>, path: string): string[] {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return [];
  }
  let nodes: unknown[] = [document];
  for (const segment of segments) {
    const next: unknown[] = [];
    const wildcard = segment.endsWith("[*]");
    const key = wildcard ? segment.slice(0, -3) : segment;
    if (!key || key.includes("[") || key.includes("]")) {
      return [];
    }
    for (const node of nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        continue;
      }
      const value = (node as Record<string, unknown>)[key];
      if (wildcard) {
        if (!Array.isArray(value)) {
          continue;
        }
        for (const entry of value) {
          next.push(entry);
        }
      } else {
        next.push(value);
      }
    }
    nodes = next;
  }
  const values: string[] = [];
  for (const node of nodes) {
    if (typeof node === "string" && node.length > 0) {
      values.push(node);
    } else if (typeof node === "number" && Number.isFinite(node)) {
      values.push(String(node));
    }
  }
  return values;
}

export function tagValueFromPath(document: Record<string, unknown>, tag: PathDynamicTag): string | undefined {
  return pickFromValues(valuesAtPath(document, tag.path), tag);
}
