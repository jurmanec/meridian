import Link from "next/link";
import { ConnectionForm } from "../connection-form";

export default function NewConnectionPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/connections" className="text-sm text-muted-foreground hover:text-foreground">
          Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New connection</h1>
        <p className="text-sm text-muted-foreground">The secret is stored on the connection, not on a job.</p>
      </div>
      <ConnectionForm />
    </main>
  );
}
