import type { WindowMode } from "@/db/schema";
import { nextCronSlot } from "./cron";
import { computeWindow } from "./window";

export type ScheduledRun = {
  runAt: Date;
  windowStart: Date;
  windowEnd: Date;
};

export function upcomingRuns(input: {
  now: Date;
  count: number;
  windowMode: WindowMode;
  maxLookbackSeconds: number;
  intervalSeconds: number;
  cron: string;
}): ScheduledRun[] {
  const runs: ScheduledRun[] = [];
  let lastSuccessEnd: Date | null = null;
  if (input.cron.trim()) {
    let after = new Date(input.now.getTime() - 1);
    for (let step = 0; runs.length < input.count && step < 1000; step += 1) {
      const runAt = nextCronSlot(input.cron, after);
      const window = computeWindow({
        now: runAt,
        mode: input.windowMode,
        maxLookbackSeconds: input.maxLookbackSeconds,
        lastSuccessEnd,
      });
      if (window.end.getTime() > window.start.getTime() && (lastSuccessEnd === null || window.end.getTime() > lastSuccessEnd.getTime())) {
        runs.push({ runAt, windowStart: window.start, windowEnd: window.end });
        lastSuccessEnd = window.end;
      }
      after = runAt;
    }
    return runs;
  }

  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds <= 0) {
    return [];
  }
  let runAt = input.now;
  for (let step = 0; runs.length < input.count && step < 1000; step += 1) {
    const window = computeWindow({
      now: runAt,
      mode: input.windowMode,
      maxLookbackSeconds: input.maxLookbackSeconds,
      lastSuccessEnd,
    });
    if (window.end.getTime() > window.start.getTime() && (lastSuccessEnd === null || window.end.getTime() > lastSuccessEnd.getTime())) {
      runs.push({ runAt, windowStart: window.start, windowEnd: window.end });
      lastSuccessEnd = window.end;
    }
    runAt = new Date(runAt.getTime() + input.intervalSeconds * 1000);
  }
  return runs;
}
