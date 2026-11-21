import type { Tags } from "@/db/schema";

export type JobOption = {
  id: string;
  name: string;
  metrics: string[];
  staticTags: Tags;
};

export type TagSelector = {
  key: string;
  match: "equals" | "regex";
  value: string;
};

export type JobMatch = {
  job: JobOption;
  warning: string;
};

export function sharedMetrics(jobs: JobOption[]): string[] {
  if (jobs.length === 0) {
    return [];
  }
  const [first, ...rest] = jobs;
  return first.metrics.filter((metric) => rest.every((job) => job.metrics.includes(metric)));
}

export function differingTags(jobs: JobOption[]): Record<string, string[]> {
  if (jobs.length === 0) {
    return {};
  }
  const keys = new Set(jobs.flatMap((job) => Object.keys(job.staticTags)));
  const result: Record<string, string[]> = {};
  for (const key of [...keys].sort()) {
    if (!jobs.every((job) => typeof job.staticTags[key] === "string" && job.staticTags[key].length > 0)) {
      continue;
    }
    const values = [...new Set(jobs.map((job) => job.staticTags[key]))].sort();
    if (values.length > 1) {
      result[key] = values;
    }
  }
  return result;
}

export function applySelection(
  jobs: JobOption[],
  input: { tags: TagSelector[]; jobName: string; metricName: string },
): { error: string; matches: JobMatch[] } {
  for (const tag of input.tags) {
    if (tag.match !== "regex" || tag.value.trim().length === 0) {
      continue;
    }
    try {
      new RegExp(tag.value);
    } catch {
      return { error: `The pattern for ${tag.key.trim() || "a tag"} is not a valid regular expression.`, matches: [] };
    }
  }

  const jobName = input.jobName.trim().toLowerCase();
  const metricName = input.metricName.trim();
  const tags = input.tags.filter((tag) => tag.key.trim().length > 0 && tag.value.trim().length > 0);
  const matches: JobMatch[] = [];
  for (const job of jobs) {
    if (jobName && !job.name.toLowerCase().includes(jobName)) {
      continue;
    }
    if (!tags.every((tag) => tagMatches(job.staticTags[tag.key.trim()] ?? "", tag))) {
      continue;
    }
    const missingMetric = metricName.length > 0 && !job.metrics.includes(metricName);
    if (missingMetric && jobName.length === 0 && tags.length === 0) {
      continue;
    }
    matches.push({ job, warning: missingMetric ? `Does not write ${metricName}.` : "" });
  }
  return { error: "", matches };
}

function tagMatches(actual: string, tag: TagSelector): boolean {
  if (actual.length === 0) {
    return false;
  }
  if (tag.match === "equals") {
    return actual === tag.value.trim();
  }
  return new RegExp(tag.value).test(actual);
}
