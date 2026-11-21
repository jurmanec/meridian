"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import {
  dynamicTagKey,
  normalizeDynamicTags,
  pathPickModes,
  type DynamicTag,
  type PathPickMode,
} from "@/db/dynamic-tags";
import type { WindowMode } from "@/db/schema";
import { createJob, getConnection, updateJob } from "@/db/store";
import { cronError } from "@/scheduler/cron";
import { collectDynamo } from "@/sources/dynamodb/connector";
import { aggregations, cardinalityWarning, metricNameFor } from "@/sources/dynamodb/items";
import { seriesKey } from "@/monitor/message";

export type FormState = { error: string };

export type PreviewState = {
  error: string;
  ran: boolean;
  windowStart: string;
  windowEnd: string;
  rows: { sk: string; status: string }[];
  rowCount: number;
  points: { metricName: string; value: number; tags: string }[];
  warning: string;
};

const previewRows = 8;

const windowModes: WindowMode[] = ["since_last_run", "fixed_lookback", "calendar"];

type ReductionField = { aggregation: string; field: string; metricName: string };

type CommonFields = {
  connectionId: string;
  intervalSeconds: number;
  cron: string;
  windowMode: WindowMode;
  maxLookbackSeconds: number;
  query: string;
  reductions: ReductionField[];
  dynamicTags: DynamicTag[];
  staticTags: Record<string, string>;
};

function readDynamicTags(formData: FormData): { error: string } | { tags: DynamicTag[] } {
  const types = formData.getAll("dynamicTagType").map((value) => String(value).trim());
  const names = formData.getAll("dynamicTagName").map((value) => String(value).trim());
  const paths = formData.getAll("dynamicTagPath").map((value) => String(value).trim());
  const picks = formData.getAll("dynamicTagPick").map((value) => String(value).trim());
  const priorities = formData.getAll("dynamicTagPriority").map((value) => String(value).trim());
  const emptyModes = formData.getAll("dynamicTagWhenEmptyMode").map((value) => String(value).trim());
  const emptyValues = formData.getAll("dynamicTagWhenEmptyValue").map((value) => String(value).trim());
  const absents = formData.getAll("dynamicTagAbsent").map((value) => String(value).trim());
  // #region agent log
  fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'save-pre',hypothesisId:'F_G',location:'actions.ts:readDynamicTags',message:'raw dynamic tag form arrays',data:{types,names,paths,picks,priorities,emptyModes,emptyValues,absents,arrayLens:{types:types.length,names:names.length,paths:paths.length,picks:picks.length,priorities:priorities.length,emptyModes:emptyModes.length,emptyValues:emptyValues.length,absents:absents.length}},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const tags: DynamicTag[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const kind = types[index] ?? "field";
    const absent = absents[index] === "zero" ? "zero" : "omit";
    if (kind === "path") {
      const tag = names[index] ?? "";
      const path = paths[index] ?? "";
      const pick = (picks[index] ?? "first") as PathPickMode;
      const priority = (priorities[index] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const emptyMode = emptyModes[index] ?? "omit";
      const emptyValue = emptyValues[index] ?? "";
      if (!tag && !path) {
        continue;
      }
      if (!tag || !path) {
        return { error: "A path dynamic tag needs a tag name and a path." };
      }
      if (!pathPickModes.includes(pick)) {
        return { error: "Choose how to pick one value from the path." };
      }
      if (pick === "priority" && priority.length === 0) {
        return { error: "A priority list needs at least one value." };
      }
      if (emptyMode === "value" && !emptyValue) {
        return { error: "Enter a value to use when the path finds nothing." };
      }
      tags.push({
        type: "path",
        tag,
        path,
        pick,
        priority: pick === "priority" ? priority : [],
        whenEmpty: emptyMode === "value" ? emptyValue : null,
        absent,
      });
      continue;
    }
    const name = names[index] ?? "";
    if (!name) {
      continue;
    }
    tags.push({ type: "field", name, absent });
  }
  const normalized = normalizeDynamicTags(tags);
  if (new Set(normalized.map(dynamicTagKey)).size !== normalized.length) {
    return { error: "Dynamic tag names must be unique." };
  }
  return { tags: normalized };
}

function readStaticTags(formData: FormData): { error: string } | { staticTags: Record<string, string> } {
  const raw = formData.get("staticTagsJson");
  if (typeof raw === "string") {
    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch {
      return { error: "Static tags could not be read." };
    }
    if (!Array.isArray(entries)) {
      return { error: "Static tags could not be read." };
    }
    const staticTags: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        return { error: "A tag needs both a key and a value." };
      }
      const key = String("key" in entry ? entry.key : "").trim();
      const value = String("value" in entry ? entry.value : "").trim();
      if (key.length === 0 && value.length === 0) {
        continue;
      }
      if (key.length === 0 || value.length === 0) {
        return { error: "A tag needs both a key and a value." };
      }
      if (key in staticTags) {
        return { error: "Tag keys must be unique." };
      }
      staticTags[key] = value;
    }
    return { staticTags };
  }

  const tagKeys = formData.getAll("tagKey").map((value) => String(value).trim());
  const tagValues = formData.getAll("tagValue").map((value) => String(value).trim());
  const staticTags: Record<string, string> = {};
  for (let index = 0; index < tagKeys.length; index += 1) {
    const key = tagKeys[index] ?? "";
    const value = tagValues[index] ?? "";
    if (key.length === 0 && value.length === 0) {
      continue;
    }
    if (key.length === 0 || value.length === 0) {
      return { error: "A tag needs both a key and a value." };
    }
    if (key in staticTags) {
      return { error: "Tag keys must be unique." };
    }
    staticTags[key] = value;
  }
  return { staticTags };
}

function readCommon(formData: FormData): { error: string } | { fields: CommonFields } {
  const connectionId = String(formData.get("connectionId") ?? "").trim();
  const schedule = String(formData.get("schedule") ?? "interval");
  const intervalSeconds = Number(formData.get("intervalSeconds"));
  const cron = schedule === "cron" ? String(formData.get("cron") ?? "").trim() : "";
  const windowMode = String(formData.get("windowMode") ?? "since_last_run");
  const maxLookbackSeconds = Number(formData.get("maxLookbackSeconds"));
  const query = String(formData.get("query") ?? "").trim();
  const aggregationValues = formData.getAll("aggregation").map((value) => String(value).trim());
  const fields = formData.getAll("field").map((value) => String(value).trim());
  const dynamic = readDynamicTags(formData);
  if ("error" in dynamic) {
    return dynamic;
  }
  const staticParsed = readStaticTags(formData);
  if ("error" in staticParsed) {
    return staticParsed;
  }

  if (!connectionId) {
    return { error: "A connection is required." };
  }
  if (!query) {
    return { error: "A query is required." };
  }
  if (!windowModes.includes(windowMode as WindowMode)) {
    return { error: "Choose a window." };
  }
  if (schedule === "cron") {
    const error = cron ? cronError(cron) : "Cron is required.";
    if (error) {
      return { error };
    }
  } else if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    return { error: "Interval must be a whole number of seconds." };
  }
  if (!Number.isInteger(maxLookbackSeconds) || maxLookbackSeconds <= 0) {
    return { error: "Lookback must be a whole number of seconds." };
  }
  if (aggregationValues.length === 0 || aggregationValues.length !== fields.length) {
    return { error: "A job needs at least one reduction." };
  }
  if (aggregationValues.some((aggregation) => !aggregations.includes(aggregation as (typeof aggregations)[number]))) {
    return { error: "Each reduction needs a supported aggregation." };
  }
  if (aggregationValues.some((aggregation, index) => aggregation !== "count" && !(fields[index] ?? "").length)) {
    return { error: "Each reduction other than count needs a field." };
  }
  let reductions: ReductionField[];
  try {
    reductions = aggregationValues.map((aggregation, index) => {
      const field = fields[index] ?? "";
      return { aggregation, field, metricName: metricNameFor(aggregation, field) };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Each reduction needs a field." };
  }
  if (new Set(reductions.map((reduction) => reduction.metricName)).size !== reductions.length) {
    return { error: "Each reduction on a job needs its own metric name." };
  }

  const staticTags = staticParsed.staticTags;

  // #region agent log
  fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'save-pre',hypothesisId:'F_H',location:'actions.ts:readCommon',message:'parsed job fields before save/preview',data:{query,staticTags,dynamicTags:dynamic.tags,staticTagsJson:String(formData.get('staticTagsJson')??'').slice(0,500)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return {
    fields: {
      connectionId,
      intervalSeconds: Number.isInteger(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 300,
      cron,
      windowMode: windowMode as WindowMode,
      maxLookbackSeconds,
      query,
      reductions,
      dynamicTags: dynamic.tags,
      staticTags,
    },
  };
}

function emptyPreview(error: string): PreviewState {
  return { error, ran: true, windowStart: "", windowEnd: "", rows: [], rowCount: 0, points: [], warning: "" };
}

export async function previewJobAction(_state: PreviewState, formData: FormData): Promise<PreviewState> {
  const parsed = readCommon(formData);
  if ("error" in parsed) {
    return emptyPreview(parsed.error);
  }
  const fields = parsed.fields;

  const previewSeconds = Number(formData.get("previewSeconds"));
  if (!Number.isInteger(previewSeconds) || previewSeconds <= 0) {
    return emptyPreview("Preview window must be a whole number of seconds.");
  }

  const source = await getConnection(getDb(), fields.connectionId);
  if (!source) {
    return emptyPreview("Choose a connection.");
  }
  if (source.sourceType !== "dynamodb") {
    return emptyPreview("This source has no connector yet.");
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - previewSeconds * 1000);

  try {
    const collected = await collectDynamo({
      sourceType: source.sourceType,
      query: { text: fields.query },
      reductions: fields.reductions,
      dynamicTags: fields.dynamicTags,
      staticTags: fields.staticTags,
      windowStart,
      windowEnd,
      connection: { config: source.config, secret: source.secret },
    });
    const series = new Set(collected.points.map((point) => seriesKey(point.tags))).size;
    return {
      error: "",
      ran: true,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      rows: collected.items.slice(0, previewRows).map((item) => ({ sk: item.sk, status: item.status })),
      rowCount: collected.items.length,
      points: collected.points.map((point) => ({
        metricName: point.metricName,
        value: point.value,
        tags: Object.entries(point.tags).map(([key, value]) => `${key}=${value}`).join(", ") || "none",
      })),
      warning: cardinalityWarning(series),
    };
  } catch (error) {
    unstable_rethrow(error);
    return emptyPreview(error instanceof Error ? error.message : "Preview failed.");
  }
}

export async function createJobAction(_state: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const parsed = readCommon(formData);
  if (!name) {
    return { error: "Name and connection are required." };
  }
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const fields = parsed.fields;

  try {
    const { job } = await createJob(getDb(), {
      name,
      connectionId: fields.connectionId,
      query: { text: fields.query },
      windowMode: fields.windowMode,
      maxLookbackSeconds: fields.maxLookbackSeconds,
      intervalSeconds: fields.intervalSeconds,
      cron: fields.cron,
      dynamicTags: fields.dynamicTags,
      staticTags: fields.staticTags,
      reductions: fields.reductions.map((reduction) => ({
        aggregation: reduction.aggregation,
        metricName: reduction.metricName,
        field: reduction.field || null,
        filter: null,
      })),
    });
    redirect(`/jobs/${job.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return jobSaveError(error);
  }
}

export async function updateJobAction(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const parsed = readCommon(formData);
  if (!name) {
    return { error: "Name and connection are required." };
  }
  if ("error" in parsed) {
    // #region agent log
    fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'save-pre',hypothesisId:'I',location:'actions.ts:updateJobAction',message:'update rejected before persist',data:{jobId,name,error:parsed.error},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return { error: parsed.error };
  }
  const fields = parsed.fields;

  try {
    // #region agent log
    fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'save-pre',hypothesisId:'F_H',location:'actions.ts:updateJobAction',message:'persisting job update',data:{jobId,name,staticTags:fields.staticTags,dynamicTags:fields.dynamicTags},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    await updateJob(getDb(), jobId, {
      name,
      connectionId: fields.connectionId,
      query: { text: fields.query },
      windowMode: fields.windowMode,
      maxLookbackSeconds: fields.maxLookbackSeconds,
      intervalSeconds: fields.intervalSeconds,
      cron: fields.cron,
      dynamicTags: fields.dynamicTags,
      staticTags: fields.staticTags,
      reductions: fields.reductions.map((reduction) => ({
        aggregation: reduction.aggregation,
        metricName: reduction.metricName,
        field: reduction.field || null,
        filter: null,
      })),
    });
    redirect(`/jobs/${jobId}`);
  } catch (error) {
    unstable_rethrow(error);
    return jobSaveError(error);
  }
}

function jobSaveError(error: unknown): FormState {
  if (error instanceof Error && (error.message.startsWith("Each reduction") || error.message.startsWith("A job needs") || error.message.startsWith("A job already writes") || error.message === "Job not found")) {
    return { error: error.message };
  }
  throw error;
}
