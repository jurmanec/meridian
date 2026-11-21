import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getJobDetail } from "@/db/store";
import { normalizeDynamicTags } from "@/db/dynamic-tags";
import type { Tags } from "@/db/schema";
import { nextCollectionWindow } from "@/scheduler/run-due";
import { RunNow } from "../run-now";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-10 text-sm text-muted-foreground">Loading job…</p>}>
      <JobDetail params={params} />
    </Suspense>
  );
}

async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const detail = await getJobDetail(getDb(), id);
  if (!detail) {
    notFound();
  }

  const { job, connection: source, reductions, runs, points } = detail;
  const upcoming = await nextCollectionWindow(getDb(), job.id, new Date());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{job.name}</h1>
          <span className="flex gap-2">
            <Link href={`/jobs/${job.id}/copy`} className={buttonVariants({ variant: "outline" })}>
              Copy
            </Link>
            <Link href={`/jobs/${job.id}/edit`} className={buttonVariants({ variant: "outline" })}>
              Edit
            </Link>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{source?.name ?? "Missing connection"}</p>
        {upcoming ? (
          <RunNow
            jobId={job.id}
            label="Run now"
            windowStart={stamp(upcoming.start)}
            windowEnd={stamp(upcoming.end)}
            canRun={upcoming.canRun}
            reason={upcoming.reason}
            scheduleOff={!job.enabled}
          />
        ) : null}
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{job.health === "failing" ? "Failing" : "OK"}</dd>
        <dt className="text-muted-foreground">Query</dt>
        <dd className="whitespace-pre-wrap">{queryText(job.query)}</dd>
        <dt className="text-muted-foreground">Window</dt>
        <dd>{windowLabel(job.windowMode)}</dd>
        <dt className="text-muted-foreground">{job.windowMode === "since_last_run" ? "Safety maximum" : job.windowMode === "calendar" ? "Calendar bucket" : "Lookback"}</dt>
        <dd>{job.maxLookbackSeconds} seconds</dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd>{job.cron ? job.cron : `${job.intervalSeconds} seconds`}</dd>
        <dt className="text-muted-foreground">Reductions</dt>
        <dd>{reductions.map((reduction) => formatReduction(reduction)).join(", ")}</dd>
        <dt className="text-muted-foreground">Dynamic tags</dt>
        <dd>
          <DynamicTagsList value={job.dynamicTags} />
        </dd>
        <dt className="text-muted-foreground">Static tags</dt>
        <dd>{formatTags(job.staticTags)}</dd>
      </dl>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 px-4 py-3">
                <span>
                  {stamp(run.windowStart)} – {stamp(run.windowEnd)}
                </span>
                <span className="text-muted-foreground">{run.status}{run.error ? `: ${run.error}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Points</h2>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">No points yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {points.map((point) => (
              <li key={`${stamp(point.time)}-${point.metricName}-${formatTags(point.tags)}`} className="flex items-center justify-between gap-4 px-4 py-3">
                <span>
                  {point.metricName}
                  <span className="text-muted-foreground"> {formatTags(point.tags)}</span>
                </span>
                <span>
                  {point.value} <span className="text-muted-foreground">{stamp(point.time)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function windowLabel(mode: string): string {
  if (mode === "fixed_lookback") {
    return "Fixed lookback";
  }
  if (mode === "calendar") {
    return "Calendar";
  }
  return "Since last successful run";
}

function formatReduction(reduction: { aggregation: string; metricName: string; field: string | null; filter: Record<string, unknown> | null }): string {
  if (reduction.aggregation === "count") {
    const filter = filterText(reduction.filter);
    return filter ? `count where ${filter} → ${reduction.metricName}` : `count → ${reduction.metricName}`;
  }
  return `${reduction.aggregation} ${reduction.field ?? ""} → ${reduction.metricName}`;
}

function filterText(filter: Record<string, unknown> | null): string {
  if (!filter) {
    return "";
  }
  return Object.entries(filter)
    .map(([key, value]) => `${key} = ${String(value)}`)
    .join(" AND ");
}

function queryText(query: Record<string, unknown>): string {
  if (typeof query.text === "string" && query.text.trim().length > 0) {
    return query.text;
  }
  if (typeof query.partitionKey === "string" && query.partitionKey.length > 0) {
    return `pk = ${query.partitionKey}`;
  }
  return "None";
}

function stamp(value: Date | string): string {
  return new Date(value).toISOString();
}

function formatTags(tags: Tags): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) {
    return "None";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function DynamicTagsList({ value }: { value: unknown }) {
  const tags = normalizeDynamicTags(value);
  if (tags.length === 0) {
    return "None";
  }
  return (
    <ul className="flex flex-col gap-1">
      {tags.map((tag) => {
        const role = tag.absent === "zero" ? "condition" : "identity";
        const label =
          tag.type === "path"
            ? `${tag.tag} ← ${tag.path} (${tag.pick}${tag.pick === "priority" ? `: ${tag.priority.join(" > ")}` : ""}; empty=${tag.whenEmpty ?? "omit"}; ${role})`
            : `${tag.name} (${role})`;
        return <li key={tag.type === "path" ? `path:${tag.tag}` : `field:${tag.name}`}>{label}</li>;
      })}
    </ul>
  );
}
