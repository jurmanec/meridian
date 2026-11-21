import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { getMonitorDetail, listJobsForMonitors } from "@/db/store";
import { MonitorForm } from "../../monitor-form";

export default function EditMonitorPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading monitor…</p>}>
        <EditMonitor params={params} />
      </Suspense>
    </main>
  );
}

async function EditMonitor({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const detail = await getMonitorDetail(db, id);
  if (!detail) {
    notFound();
  }
  const jobs = (await listJobsForMonitors(db)).filter((job) => job.metrics.length > 0);
  const { monitor } = detail;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`/monitors/${monitor.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          {monitor.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit monitor</h1>
      </div>
      <MonitorForm
        key={monitor.id}
        jobs={jobs}
        monitor={{
          id: monitor.id,
          name: monitor.name,
          jobIds: monitor.jobs.map((job) => job.id),
          metricName: monitor.metricName,
          tagFilter: monitor.tagFilter,
          threshold: monitor.threshold,
          consecutivePoints: monitor.consecutivePoints,
          severity: monitor.severity,
          team: monitor.team,
          manualUrl: monitor.manualUrl,
          notifyMode: monitor.notifyMode,
        }}
      />
    </>
  );
}
