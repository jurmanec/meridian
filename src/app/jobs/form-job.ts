import type { DynamicTag, WindowMode } from "@/db/schema";
import type { JobFormJob } from "./job-form";

type SourceJob = {
  id: string;
  name: string;
  connectionId: string;
  query: Record<string, unknown>;
  windowMode: WindowMode;
  maxLookbackSeconds: number;
  intervalSeconds: number;
  cron: string;
  dynamicTags: DynamicTag[] | string[];
  staticTags: Record<string, string>;
};

type SourceReduction = {
  aggregation: string;
  field: string | null;
  metricName: string;
};

export function toFormJob(job: SourceJob, reductions: SourceReduction[], copy = false): JobFormJob {
  const formJob = {
    id: copy ? undefined : job.id,
    name: copy ? `${job.name} copy` : job.name,
    connectionId: job.connectionId,
    query: queryText(job.query),
    windowMode: job.windowMode,
    maxLookbackSeconds: job.maxLookbackSeconds,
    intervalSeconds: job.intervalSeconds,
    cron: job.cron,
    reductions: reductions.map((reduction) => ({
      aggregation: reduction.aggregation,
      field: reduction.field,
      metricName: reduction.metricName,
    })),
    dynamicTags: job.dynamicTags,
    staticTags: job.staticTags,
  };
  // #region agent log
  fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'edit-load',hypothesisId:'B',location:'form-job.ts:toFormJob',message:'toFormJob dynamicTags passthrough',data:{copy,jobId:formJob.id ?? null,name:formJob.name,dynamicTags:formJob.dynamicTags},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return formJob;
}

function queryText(query: Record<string, unknown>): string {
  if (typeof query.text === "string") {
    return query.text;
  }
  if (typeof query.partitionKey === "string" && query.partitionKey.length > 0) {
    return `pk = ${query.partitionKey}`;
  }
  return "";
}
