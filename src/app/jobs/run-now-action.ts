"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { runJobNow, type JobRunResult } from "@/scheduler/run-due";
import { createDynamoConnector } from "@/sources/dynamodb/connector";

export type RunNowState = { message: string };

const connectors = new Map([["dynamodb", createDynamoConnector()]]);

export async function runJobNowAction(_state: RunNowState, formData: FormData): Promise<RunNowState> {
  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!jobId) {
    return { message: "Job not found." };
  }
  const result = await runJobNow(getDb(), jobId, new Date(), connectors);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/monitors", "layout");
  return { message: describeRun(result) };
}

function describeRun(result: JobRunResult): string {
  const range = `${result.windowStart.toISOString()}–${result.windowEnd.toISOString()}`;
  if (result.status === "skipped") {
    return `${result.error} ${range}.`;
  }
  if (result.status === "failed") {
    return `Could not collect ${range}. ${result.error}`;
  }
  const points = result.points
    .map((point) => {
      const tags = Object.entries(point.tags)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      return tags ? `${point.metricName} = ${point.value} (${tags})` : `${point.metricName} = ${point.value}`;
    })
    .join("; ");
  const changes =
    result.transitions.length === 0
      ? "No monitor changed."
      : result.transitions
          .map((item) => {
            const verb = item.transition === "firing" ? "fired" : "resolved";
            return item.paged ? `${item.monitorName} ${verb}.` : `${item.monitorName} ${verb}. Slack was not sent.`;
          })
          .join(" ");
  const evaluation = result.error ? ` ${result.error}` : "";
  return `Collected ${range}. ${points}. ${changes}${evaluation}`;
}
