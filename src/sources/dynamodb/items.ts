import type { DynamicTag, Tags } from "@/db/schema";
import { normalizeDynamicTags, tagValueFromPath } from "@/db/dynamic-tags";
import { normalizeTags } from "@/db/tags";
import type { SourcePoint } from "@/scheduler/source";

export type SnapshotItem = {
  pk: string;
  sk: string;
  status: string;
  fields?: Record<string, string | number>;
  /** Full source item for path-based dynamic tags. */
  document?: Record<string, unknown>;
};

export const aggregations = ["count", "sum", "mean", "min", "max", "p95", "distinct_count"] as const;
export const cardinalityWarningAt = 10;

export function metricNameFor(aggregation: string, field?: string | null): string {
  if (aggregation === "count") {
    return "row_count";
  }
  const name = (field ?? "").trim();
  if (!name) {
    throw new Error("This reduction needs a field");
  }
  return `${name}_${aggregation}`;
}

const timestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z/;

export function canonicalSortKey(sk: string): string {
  const timestamp = sk.split("#")[0] ?? sk;
  const match = timestampPattern.exec(timestamp);
  if (!match) {
    return timestamp;
  }
  const fraction = (match[2] ?? "").padEnd(9, "0");
  return `${match[1]}.${fraction}Z`;
}

export function formatSortBound(time: Date): string {
  return canonicalSortKey(time.toISOString());
}

export function sortKeyInWindow(sk: string, windowStart: Date, windowEnd: Date): boolean {
  const key = canonicalSortKey(sk);
  return key >= formatSortBound(windowStart) && key < formatSortBound(windowEnd);
}

export function readPartitionKey(query: Record<string, unknown>): string {
  const value = query.partitionKey;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("A DynamoDB job needs a partition key");
  }
  return value.trim();
}

export function itemsInWindow(items: SnapshotItem[], partitionKey: string, windowStart: Date, windowEnd: Date): SnapshotItem[] {
  return items.filter((item) => item.pk === partitionKey && sortKeyInWindow(item.sk, windowStart, windowEnd));
}

export function cardinalityWarning(series: number): string {
  if (series > cardinalityWarningAt) {
    return `High cardinality: ${series} series in this window.`;
  }
  return "";
}

export function reduceSnapshots(
  items: SnapshotItem[],
  reductions: { aggregation: string; metricName: string; field?: string | null; filter?: Record<string, unknown> | null }[],
  dynamicTags: DynamicTag[] | string[],
): SourcePoint[] {
  if (reductions.length === 0) {
    throw new Error("A job needs at least one reduction");
  }
  for (const reduction of reductions) {
    if (!aggregations.includes(reduction.aggregation as (typeof aggregations)[number])) {
      throw new Error(`Unsupported aggregation ${reduction.aggregation}`);
    }
    if (reduction.aggregation !== "count" && !(reduction.field && reduction.field.trim())) {
      throw new Error("This reduction needs a field");
    }
  }

  const tags = normalizeDynamicTags(dynamicTags);
  const points: SourcePoint[] = [];
  for (const group of groupItems(items, tags)) {
    for (const reduction of reductions) {
      points.push({
        metricName: reduction.metricName,
        value: aggregate(group.items, reduction),
        tags: group.tags,
      });
    }
  }
  return points;
}

function groupItems(items: SnapshotItem[], dynamicTags: DynamicTag[]): { tags: Tags; items: SnapshotItem[] }[] {
  if (items.length === 0) {
    return [{ tags: {}, items: [] }];
  }
  const groups = new Map<string, { tags: Tags; items: SnapshotItem[] }>();
  for (const item of items) {
    const tags: Tags = {};
    for (const tag of dynamicTags) {
      if (tag.type === "field") {
        const value = item.fields?.[tag.name];
        if (typeof value === "string" && value.length > 0) {
          tags[tag.name] = value;
        } else if (typeof value === "number" && Number.isFinite(value)) {
          tags[tag.name] = String(value);
        }
        continue;
      }
      const document = item.document ?? fieldsAsDocument(item);
      const value = tagValueFromPath(document, tag);
      if (value) {
        tags[tag.tag] = value;
      }
    }
    const key = JSON.stringify(normalizeTags(tags));
    const group = groups.get(key) ?? { tags: normalizeTags(tags), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function fieldsAsDocument(item: SnapshotItem): Record<string, unknown> {
  return {
    pk: item.pk,
    sk: item.sk,
    status: item.status,
    ...(item.fields ?? {}),
  };
}

export function itemValue(item: SnapshotItem, key: string): string {
  if (key === "pk") {
    return item.pk;
  }
  if (key === "sk") {
    return item.sk;
  }
  if (key === "status") {
    return item.status;
  }
  const value = item.fields?.[key];
  return value === undefined ? "" : String(value);
}

function aggregate(items: SnapshotItem[], reduction: { aggregation: string; field?: string | null; filter?: Record<string, unknown> | null }): number {
  if (reduction.aggregation === "count") {
    const filter = reduction.filter;
    return items.filter((item) => {
      if (!filter) {
        return true;
      }
      return Object.entries(filter).every(([key, value]) => itemValue(item, key) === String(value));
    }).length;
  }
  const field = reduction.field ?? "";
  if (reduction.aggregation === "distinct_count") {
    const values = items
      .map((item) => item.fields?.[field])
      .filter((value) => value !== undefined && value !== "")
      .map((value) => String(value));
    return new Set(values).size;
  }
  const values = numericValues(items, field);
  if (values.length === 0) {
    return 0;
  }
  if (reduction.aggregation === "sum") {
    return values.reduce((total, value) => total + value, 0);
  }
  if (reduction.aggregation === "mean") {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  if (reduction.aggregation === "min") {
    return Math.min(...values);
  }
  if (reduction.aggregation === "max") {
    return Math.max(...values);
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

function numericValues(items: SnapshotItem[], field: string): number[] {
  const values: number[] = [];
  for (const item of items) {
    const value = item.fields?.[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push(value);
    } else if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      values.push(Number(value));
    }
  }
  return values;
}
