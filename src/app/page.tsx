import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Meridian</h1>
      <p className="max-w-xl text-muted-foreground">
        Attach data sources, evaluate thresholds, and report incidents — primarily
        as alert webhook payloads. Slack is a secondary notify option.
      </p>
      <p className="flex gap-4 text-sm">
        <Link href="/connections" className="underline">
          Connections
        </Link>
        <Link href="/jobs" className="underline">
          Jobs
        </Link>
        <Link href="/monitors" className="underline">
          Monitors
        </Link>
      </p>
    </main>
  );
}
