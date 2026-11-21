import type { WindowMode } from "@/db/schema";

export function computeWindow(input: {
  now: Date;
  mode?: WindowMode;
  maxLookbackSeconds: number;
  lastSuccessEnd: Date | null;
}): { start: Date; end: Date } {
  const end = input.now;
  const mode = input.mode ?? "since_last_run";
  if (mode === "fixed_lookback") {
    return { start: new Date(end.getTime() - input.maxLookbackSeconds * 1000), end };
  }
  if (mode === "calendar") {
    const bucket = input.maxLookbackSeconds * 1000;
    const endMs = Math.floor(end.getTime() / bucket) * bucket;
    return { start: new Date(endMs - bucket), end: new Date(endMs) };
  }
  const earliest = new Date(end.getTime() - input.maxLookbackSeconds * 1000);
  const start =
    input.lastSuccessEnd !== null && input.lastSuccessEnd.getTime() > earliest.getTime()
      ? input.lastSuccessEnd
      : earliest;
  return { start, end };
}
