"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { parseSeverityConfig, type SeverityConfig } from "@/db/severity";
import type { NotifyMode } from "@/db/schema";
import { createMonitor, getMonitorDetail, listJobsForMonitors, updateMonitor } from "@/db/store";

export type FormState = { error: string };

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type MonitorFields = {
  name: string;
  jobIds: string[];
  metricName: string;
  threshold: number;
  consecutivePoints: number;
  severity: SeverityConfig;
  team: string;
  manualUrl: string;
  notifyMode: NotifyMode;
  slackWebhook: string;
  alertWebhook: string;
  tagFilter: Record<string, string[]>;
};

function readMonitorFields(
  formData: FormData,
  options: { requireNotifyUrl: boolean },
): { error: string } | { fields: MonitorFields } {
  const name = String(formData.get("name") ?? "").trim();
  const jobIds = [...new Set(formData.getAll("jobId").map((value) => String(value).trim()).filter((value) => value.length > 0))];
  const metricName = String(formData.get("metricName") ?? "").trim();
  const threshold = Number(formData.get("threshold"));
  const consecutivePoints = Number(formData.get("consecutivePoints"));
  const severityRaw = formData.get("severityJson") ?? formData.get("severity");
  const severityParsed = parseSeverityConfig(
    typeof severityRaw === "string" && severityRaw.trim().startsWith("{")
      ? (() => {
          try {
            return JSON.parse(severityRaw);
          } catch {
            return severityRaw;
          }
        })()
      : severityRaw,
  );
  if ("error" in severityParsed) {
    return severityParsed;
  }
  const team = String(formData.get("team") ?? "").trim();
  const manualUrl = String(formData.get("manualUrl") ?? "").trim();
  const notifyModeRaw = String(formData.get("notifyMode") ?? "slack").trim();
  const notifyMode: NotifyMode = notifyModeRaw === "webhook" ? "webhook" : "slack";
  const slackWebhook = String(formData.get("slackWebhook") ?? "").trim();
  const alertWebhook = String(formData.get("alertWebhook") ?? "").trim();
  const tagKeys = formData.getAll("tagKey").map((value) => String(value).trim());
  const tagValues = formData.getAll("tagValue").map((value) => String(value).trim());

  if (!name || jobIds.length === 0 || !metricName) {
    return { error: "Name, a job, and a metric are required." };
  }
  if (!Number.isFinite(threshold)) {
    return { error: "Threshold must be a number." };
  }
  if (!Number.isInteger(consecutivePoints) || consecutivePoints < 1) {
    return { error: "Consecutive points must be a whole number of at least 1." };
  }
  if (manualUrl && !httpUrl(manualUrl)) {
    return { error: "Manual URL must be an http or https link." };
  }
  if (slackWebhook && !httpUrl(slackWebhook)) {
    return { error: "Slack webhook must be an http or https link." };
  }
  if (alertWebhook && !httpUrl(alertWebhook)) {
    return { error: "Alert webhook must be an http or https link." };
  }
  if (options.requireNotifyUrl) {
    if (notifyMode === "slack" && !slackWebhook) {
      return { error: "Slack webhook must be an http or https link." };
    }
    if (notifyMode === "webhook" && !alertWebhook) {
      return { error: "Alert webhook must be an http or https link." };
    }
  }

  const tagFilter: Record<string, string[]> = {};
  for (let index = 0; index < tagKeys.length; index += 1) {
    const key = tagKeys[index] ?? "";
    const values = (tagValues[index] ?? "").split(",").map((value) => value.trim()).filter((value) => value.length > 0);
    if (key.length === 0 && values.length === 0) {
      continue;
    }
    if (key.length === 0 || values.length === 0) {
      return { error: "A tag filter needs both a key and a value." };
    }
    if (key in tagFilter) {
      return { error: "Tag filter keys must be unique." };
    }
    tagFilter[key] = values;
  }

  return {
    fields: {
      name,
      jobIds,
      metricName,
      threshold,
      consecutivePoints,
      severity: severityParsed.config,
      team,
      manualUrl,
      notifyMode,
      slackWebhook,
      alertWebhook,
      tagFilter,
    },
  };
}

export async function createMonitorAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = readMonitorFields(formData, { requireNotifyUrl: true });
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const fields = parsed.fields;

  try {
    const choices = await listJobsForMonitors(getDb());
    const chosen = choices.filter((choice) => fields.jobIds.includes(choice.id));
    if (chosen.length !== fields.jobIds.length || chosen.some((choice) => !choice.metrics.includes(fields.metricName))) {
      return { error: "Choose a metric written by each selected job." };
    }
    const monitor = await createMonitor(getDb(), {
      name: fields.name,
      jobIds: fields.jobIds,
      metricName: fields.metricName,
      tagFilter: fields.tagFilter,
      threshold: fields.threshold,
      severity: fields.severity,
      team: fields.team,
      manualUrl: fields.manualUrl,
      notifyMode: fields.notifyMode,
      slackWebhook: fields.slackWebhook,
      alertWebhook: fields.alertWebhook,
      consecutivePoints: fields.consecutivePoints,
    });
    if (!monitor) {
      return { error: "The monitor could not be saved." };
    }
    redirect(`/monitors/${monitor.id}`);
  } catch (error) {
    unstable_rethrow(error);
    throw error;
  }
}

export async function updateMonitorAction(monitorId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const parsed = readMonitorFields(formData, { requireNotifyUrl: false });
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const fields = parsed.fields;

  try {
    const db = getDb();
    const detail = await getMonitorDetail(db, monitorId);
    if (!detail) {
      return { error: "Monitor not found" };
    }
    const existing = detail.monitor;
    if (fields.notifyMode === "slack" && !(fields.slackWebhook || existing.slackWebhook)) {
      return { error: "Slack webhook must be an http or https link." };
    }
    if (fields.notifyMode === "webhook" && !(fields.alertWebhook || existing.alertWebhook)) {
      return { error: "Alert webhook must be an http or https link." };
    }
    const choices = await listJobsForMonitors(db);
    const chosen = choices.filter((choice) => fields.jobIds.includes(choice.id));
    if (chosen.length !== fields.jobIds.length || chosen.some((choice) => !choice.metrics.includes(fields.metricName))) {
      return { error: "Choose a metric written by each selected job." };
    }
    await updateMonitor(db, monitorId, {
      name: fields.name,
      jobIds: fields.jobIds,
      metricName: fields.metricName,
      tagFilter: fields.tagFilter,
      threshold: fields.threshold,
      severity: fields.severity,
      team: fields.team,
      manualUrl: fields.manualUrl,
      notifyMode: fields.notifyMode,
      slackWebhook: fields.slackWebhook || undefined,
      alertWebhook: fields.alertWebhook || undefined,
      consecutivePoints: fields.consecutivePoints,
    });
    redirect(`/monitors/${monitorId}`);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === "Monitor not found") {
      return { error: error.message };
    }
    throw error;
  }
}
