"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runJobNowAction, type RunNowState } from "./run-now-action";

const initialState: RunNowState = { message: "" };

export function RunNow({
  jobId,
  label,
  windowStart,
  windowEnd,
  canRun,
  reason,
  scheduleOff,
  compact = false,
  title,
}: {
  jobId: string;
  label: string;
  windowStart: string;
  windowEnd: string;
  canRun: boolean;
  reason: string;
  scheduleOff: boolean;
  compact?: boolean;
  title?: string;
}) {
  const [state, action, pending] = useActionState(runJobNowAction, initialState);
  const range = `${windowStart}–${windowEnd}`;

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      <p className="text-sm text-muted-foreground">
        {canRun ? `Collect ${range}, store the points, and evaluate monitors. This can send Slack.` : `${reason} ${range}.`}
        {scheduleOff ? " Runs once. The schedule stays off." : ""}
      </p>
      <Button type="submit" variant="outline" size={compact ? "sm" : "default"} disabled={!canRun || pending} className="w-fit">
        {pending ? "Collecting…" : label}
      </Button>
      {state.message ? <p className="text-sm">{state.message}</p> : null}
    </form>
  );
}
