import type { TagFilter, Tags } from "./schema";

export function normalizeTags(tags: Tags): Tags {
  const entries = Object.entries(tags);
  for (const [key, value] of entries) {
    if (typeof value !== "string" || key.length === 0) {
      throw new Error("Tags are a map of non-empty string keys to string values");
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeTagFilter(filter: Record<string, string | string[]>): TagFilter {
  const result: TagFilter = {};
  for (const [key, value] of Object.entries(filter)) {
    const allowed = (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter((item) => item.length > 0);
    if (key.trim().length === 0 || allowed.length === 0) {
      throw new Error("A tag filter needs a key and a value.");
    }
    result[key.trim()] = [...new Set(allowed)].sort();
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
