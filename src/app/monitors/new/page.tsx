import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { listJobsForMonitors } from "@/db/store";
import { MonitorForm } from "../monitor-form";

export default function NewMonitorPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/monitors" className="text-sm text-muted-foreground hover:text-foreground">
          Monitors
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New monitor</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading jobs…</p>}>
        <NewMonitorForm />
      </Suspense>
    </main>
  );
}

async function NewMonitorForm() {
  await connection();
  const jobs = await listJobsForMonitors(getDb());
  const usable = jobs.filter((job) => job.metrics.length > 0);

  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Save a job first.{" "}
        <Link href="/jobs/new" className="text-foreground underline">
          New job
        </Link>
      </p>
    );
  }

  const defaultAlertWebhook = (process.env.P8_ALERT_URL ?? "").trim();
  return <MonitorForm jobs={usable} defaultAlertWebhook={defaultAlertWebhook} />;
}
