import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listMonitors } from "@/db/store";

export default function MonitorsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Monitors</h1>
        <Link href="/monitors/new" className={buttonVariants()}>
          New monitor
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading monitors…</p>}>
        <MonitorList />
      </Suspense>
    </main>
  );
}

async function MonitorList() {
  await connection();
  const rows = await listMonitors(getDb());

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No monitors yet.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/monitors/${row.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted">
            <span className="font-medium">{row.name}</span>
            <span className="text-sm text-muted-foreground">
              {row.jobNames.join(", ") || "No jobs"}
              {row.alerting ? " · Alert" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
