import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { getJobDetail, listConnections } from "@/db/store";
import { toFormJob } from "../../form-job";
import { JobForm } from "../../job-form";

export default function CopyJobPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading job…</p>}>
        <CopyJob params={params} />
      </Suspense>
    </main>
  );
}

async function CopyJob({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const detail = await getJobDetail(db, id);
  if (!detail) {
    notFound();
  }
  const connections = await listConnections(db);
  const { job, reductions } = detail;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`/jobs/${job.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          {job.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Copy job</h1>
      </div>
      <JobForm
        connections={connections.map((row) => ({ id: row.id, name: row.name, sourceType: row.sourceType }))}
        now={new Date().toISOString()}
        job={toFormJob(job, reductions, true)}
      />
    </>
  );
}
