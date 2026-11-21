import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { listConnections } from "@/db/store";
import { JobForm } from "../job-form";

export default function NewJobPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading connections…</p>}>
        <NewJobForm />
      </Suspense>
    </main>
  );
}

async function NewJobForm() {
  await connection();
  const connections = await listConnections(getDb());

  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Save a connection first.{" "}
        <Link href="/connections/new" className="text-foreground underline">
          New connection
        </Link>
      </p>
    );
  }

  return (
    <JobForm
      connections={connections.map((row) => ({ id: row.id, name: row.name, sourceType: row.sourceType }))}
      now={new Date().toISOString()}
    />
  );
}
