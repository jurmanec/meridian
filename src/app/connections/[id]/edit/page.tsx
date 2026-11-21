import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { listConnections } from "@/db/store";
import { ConnectionForm } from "../../connection-form";

export default function EditConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading connection…</p>}>
        <EditConnection params={params} />
      </Suspense>
    </main>
  );
}

async function EditConnection({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const rows = await listConnections(getDb());
  const row = rows.find((item) => item.id === id);
  if (!row) {
    notFound();
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/connections" className="text-sm text-muted-foreground hover:text-foreground">
          Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit connection</h1>
        <p className="text-sm text-muted-foreground">The stored key is not shown. Leave both key fields blank to keep it.</p>
      </div>
      <ConnectionForm
        connection={{
          id: row.id,
          name: row.name,
          sourceType: row.sourceType,
          tableName: textConfig(row.config, "tableName"),
          region: textConfig(row.config, "region"),
          endpoint: textConfig(row.config, "endpoint"),
        }}
      />
    </>
  );
}

function textConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}
