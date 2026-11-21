import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listJobs } from "@/db/store";

export default function JobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <Link href="/jobs/new" className={buttonVariants()}>
          New job
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading jobs…</p>}>
        <JobList />
      </Suspense>
    </main>
  );
}

async function JobList() {
  await connection();
  const rows = await listJobs(getDb());

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No jobs yet.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/jobs/${row.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted">
            <span className="font-medium">{row.name}</span>
            <span className="text-sm text-muted-foreground">
              {row.connectionName}
              {row.health === "failing" ? " · Failing" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
