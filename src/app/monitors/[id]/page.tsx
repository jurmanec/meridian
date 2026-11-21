import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { formatSeverityConfig } from "@/db/severity";
import type { TagFilter, Tags } from "@/db/schema";
import { getMonitorDetail } from "@/db/store";
import { readSeriesJobId } from "@/monitor/message";
import { nextCollectionWindow } from "@/scheduler/run-due";
import { RunNow } from "../../jobs/run-now";

export default function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-10 text-sm text-muted-foreground">Loading monitor…</p>}>
      <MonitorDetail params={params} />
    </Suspense>
  );
}

async function MonitorDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const detail = await getMonitorDetail(getDb(), id);
  if (!detail) {
    notFound();
  }

  const { monitor, states, notifications } = detail;
  const db = getDb();
  const collections = await Promise.all(
    monitor.jobs.map(async (job) => ({ job, window: await nextCollectionWindow(db, job.id, new Date()) })),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/monitors" className="text-sm text-muted-foreground hover:text-foreground">
          Monitors
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{monitor.name}</h1>
          <Link href={`/monitors/${monitor.id}/edit`} className={buttonVariants({ variant: "outline" })}>
            Edit
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">{monitor.jobs.map((job) => job.name).join(", ") || "No jobs"}</p>
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Jobs</dt>
        <dd className="flex flex-col gap-4">
          {collections.length === 0 ? "None" : null}
          {collections.map(({ job, window }) =>
            window ? (
              <RunNow
                key={job.id}
                jobId={job.id}
                title={job.name}
                label="Collect now"
                windowStart={window.start.toISOString()}
                windowEnd={window.end.toISOString()}
                canRun={window.canRun}
                reason={window.reason}
                scheduleOff={!job.enabled}
                compact
              />
            ) : (
              <span key={job.id}>{job.name}</span>
            ),
          )}
        </dd>
        <dt className="text-muted-foreground">Metric</dt>
        <dd>{monitor.metricName}</dd>
        <dt className="text-muted-foreground">Tag filter</dt>
        <dd>{formatFilter(monitor.tagFilter)}</dd>
        <dt className="text-muted-foreground">Threshold</dt>
        <dd>At or above {monitor.threshold}</dd>
        <dt className="text-muted-foreground">Consecutive points</dt>
        <dd>{monitor.consecutivePoints}</dd>
        <dt className="text-muted-foreground">Severity</dt>
        <dd>{formatSeverityConfig(monitor.severity)}</dd>
        <dt className="text-muted-foreground">Team</dt>
        <dd>{monitor.team || "None"}</dd>
        <dt className="text-muted-foreground">Manual URL</dt>
        <dd>{monitor.manualUrl || "None"}</dd>
        <dt className="text-muted-foreground">Notify via</dt>
        <dd>
          {monitor.notifyMode === "webhook"
            ? `Alert webhook${monitor.alertWebhook ? ` (${monitor.alertWebhook})` : ""}`
            : "Slack webhook"}
        </dd>
      </dl>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Series</h2>
        {states.length === 0 ? (
          <p className="text-sm text-muted-foreground">No series evaluated yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {states.map((state) => {
              const jobId = readSeriesJobId(state.seriesKey);
              const jobName = monitor.jobs.find((job) => job.id === jobId)?.name;
              return (
              <li key={state.seriesKey} className="flex items-center justify-between gap-4 px-4 py-3">
                <span>{[jobName, formatTags(state.tags)].filter((part) => part && part !== "None").join(" · ") || "None"}</span>
                <span className="text-muted-foreground">
                  {state.status === "alert" ? "Alert" : "OK"} · {state.value}
                </span>
              </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Slack</h2>
        {notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages sent.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex flex-col gap-1 px-4 py-3">
                <span>
                  {notification.transition} · {notification.value}
                </span>
                <span className="text-muted-foreground">
                  {formatTags(notification.tags)} · {new Date(notification.createdAt).toISOString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatFilter(filter: TagFilter): string {
  const entries = Object.entries(filter);
  if (entries.length === 0) {
    return "None";
  }
  return entries.map(([key, values]) => (values.length === 1 ? `${key}=${values[0]}` : `${key} is any of ${values.join(", ")}`)).join(", ");
}

function formatTags(tags: Tags): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) {
    return "None";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
