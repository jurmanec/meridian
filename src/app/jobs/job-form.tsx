"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DynamicTag, WindowMode } from "@/db/schema";
import { normalizeDynamicTags, pathPickModes, type AbsentMode, type PathPickMode } from "@/db/dynamic-tags";
import { fieldClass, labelClass } from "@/lib/fields";
import { cronError } from "@/scheduler/cron";
import { upcomingRuns } from "@/scheduler/upcoming";
import { aggregations, metricNameFor } from "@/sources/dynamodb/items";
import { createJobAction, previewJobAction, updateJobAction, type FormState, type PreviewState } from "./actions";

const initialState: FormState = { error: "" };
const initialPreview: PreviewState = {
  error: "",
  ran: false,
  windowStart: "",
  windowEnd: "",
  rows: [],
  rowCount: 0,
  points: [],
  warning: "",
};

const previewPresets = [
  { seconds: "300", label: "5 minutes" },
  { seconds: "900", label: "15 minutes" },
  { seconds: "3600", label: "1 hour" },
  { seconds: "86400", label: "24 hours" },
];

const aggregationLabels: Record<(typeof aggregations)[number], string> = {
  count: "Count",
  sum: "Sum",
  mean: "Mean",
  min: "Min",
  max: "Max",
  p95: "p95",
  distinct_count: "Distinct count",
};

type ReductionDraft = { aggregation: (typeof aggregations)[number]; field: string };

type DynamicTagDraft =
  | { type: "field"; name: string; absent: AbsentMode }
  | {
      type: "path";
      tag: string;
      path: string;
      pick: PathPickMode;
      priority: string;
      whenEmptyMode: "omit" | "value";
      whenEmptyValue: string;
      absent: AbsentMode;
    };

export type JobFormJob = {
  id?: string;
  name: string;
  connectionId: string;
  query: string;
  windowMode: WindowMode;
  maxLookbackSeconds: number;
  intervalSeconds: number;
  cron: string;
  reductions: { aggregation: string; field: string | null; metricName: string }[];
  dynamicTags: DynamicTag[] | string[];
  staticTags: Record<string, string>;
};

export function JobForm({ connections, now, job }: { connections: { id: string; name: string; sourceType: string }[]; now: string; job?: JobFormJob }) {
  const submit = useMemo(() => (job?.id ? updateJobAction.bind(null, job.id) : createJobAction), [job?.id]);
  const [state, action, pending] = useActionState(submit, initialState);
  const [preview, previewAction, previewPending] = useActionState(previewJobAction, initialPreview);
  const [name, setName] = useState(job?.name ?? "");
  const [connectionId, setConnectionId] = useState(job?.connectionId ?? connections[0]?.id ?? "");
  const [query, setQuery] = useState(job?.query ?? "");
  const [windowMode, setWindowMode] = useState<WindowMode>(job?.windowMode ?? "since_last_run");
  const [maxLookbackSeconds, setMaxLookbackSeconds] = useState(String(job?.maxLookbackSeconds ?? 86400));
  const [schedule, setSchedule] = useState(job?.cron ? "cron" : "interval");
  const [intervalSeconds, setIntervalSeconds] = useState(String(job?.intervalSeconds ?? 300));
  const [cron, setCron] = useState(job?.cron || "*/5 * * * *");
  const [reductions, setReductions] = useState<ReductionDraft[]>(draftReductions(job));
  const [dynamicTags, setDynamicTags] = useState<DynamicTagDraft[]>(() => {
    const drafted = draftDynamicTags(job);
    // #region agent log
    fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'edit-load',hypothesisId:'A_B_D',location:'job-form.tsx:useState-dynamicTags',message:'edit form dynamic tag draft init',data:{jobId:job?.id ?? null,rawDynamicTags:job?.dynamicTags ?? null,drafted,pathPicks:drafted.filter((t)=>t.type==='path').map((t)=>({tag:t.tag,pick:t.pick,priority:t.priority,whenEmptyMode:t.whenEmptyMode,whenEmptyValue:t.whenEmptyValue}))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return drafted;
  });
  const [tags, setTags] = useState(draftTags(job));
  const [previewSeconds, setPreviewSeconds] = useState("300");
  const lookbackLabel = windowMode === "since_last_run" ? "Safety maximum (seconds)" : windowMode === "calendar" ? "Calendar bucket (seconds)" : "Lookback (seconds)";
  const selected = connections.find((connection) => connection.id === connectionId);
  // #region agent log
  if (typeof window !== "undefined") {
    fetch('http://127.0.0.1:7319/ingest/3cbdfb72-711e-481d-a01f-d1a45d208eb5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99d71f'},body:JSON.stringify({sessionId:'99d71f',runId:'edit-load',hypothesisId:'C_E',location:'job-form.tsx:render',message:'JobForm render path-tag picks in state',data:{jobId:job?.id ?? null,pathTags:dynamicTags.filter((t)=>t.type==='path').map((t)=>({tag:t.tag,pick:t.pick,pickInModes:['first','last','priority'].includes(t.pick),priority:t.priority}))},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion

  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Name</span>
        <input className={fieldClass} name="name" required autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Connection</span>
        <select className={fieldClass} name="connectionId" required value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} · {connection.sourceType}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Query</span>
        <textarea className={`${fieldClass} min-h-24 font-mono`} name="query" required rows={4} value={query} onChange={(event) => setQuery(event.target.value)} />
        <span className="text-sm text-muted-foreground">{queryHelp(selected?.sourceType)}</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Window</span>
        <select className={fieldClass} name="windowMode" value={windowMode} onChange={(event) => setWindowMode(event.target.value as WindowMode)}>
          <option value="since_last_run">Since last successful run</option>
          <option value="fixed_lookback">Fixed lookback</option>
          <option value="calendar">Calendar</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{lookbackLabel}</span>
        <input className={fieldClass} name="maxLookbackSeconds" type="number" min={1} step={1} required value={maxLookbackSeconds} onChange={(event) => setMaxLookbackSeconds(event.target.value)} />
        <span className="text-sm text-muted-foreground">24 hours is 86400 seconds. A calendar bucket aligns to UTC.</span>
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>Schedule</legend>
        <select className={fieldClass} name="schedule" value={schedule} onChange={(event) => setSchedule(event.target.value)}>
          <option value="interval">Interval</option>
          <option value="cron">Cron</option>
        </select>
        {schedule === "cron" ? (
          <>
            <input type="hidden" name="intervalSeconds" value="300" />
            <input className={fieldClass} name="cron" required value={cron} onChange={(event) => setCron(event.target.value)} aria-label="Cron" />
          </>
        ) : (
          <input className={fieldClass} name="intervalSeconds" type="number" min={1} step={1} required value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} aria-label="Interval (seconds)" />
        )}
        <SchedulePreview now={now} windowMode={windowMode} maxLookbackSeconds={maxLookbackSeconds} schedule={schedule} intervalSeconds={intervalSeconds} cron={cron} />
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>Reductions</legend>
        <p className="text-sm text-muted-foreground">The metric name is set from the reduction: row_count, or field_aggregation.</p>
        {reductions.map((reduction, index) => (
          <div key={index} className="grid grid-cols-2 gap-2">
            <select
              className={fieldClass}
              name="aggregation"
              aria-label="Aggregation"
              value={reduction.aggregation}
              onChange={(event) => {
                const next = [...reductions];
                next[index] = { ...reduction, aggregation: event.target.value as ReductionDraft["aggregation"] };
                setReductions(next);
              }}
            >
              {aggregations.map((aggregation) => (
                <option key={aggregation} value={aggregation}>
                  {aggregationLabels[aggregation]}
                </option>
              ))}
            </select>
            <p className="flex items-center text-sm text-muted-foreground" aria-label="Metric name">
              {reductionMetricName(reduction)}
            </p>
            {reduction.aggregation === "count" ? (
              <input type="hidden" name="field" value="" />
            ) : (
              <input className={`${fieldClass} col-span-2`} name="field" aria-label="Field" placeholder="Source field" value={reduction.field} onChange={(event) => {
                const next = [...reductions];
                next[index] = { ...reduction, field: event.target.value };
                setReductions(next);
              }} />
            )}
            {reductions.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                className="col-span-2 w-fit"
                onClick={() => setReductions(reductions.filter((_, item) => item !== index))}
              >
                Remove reduction
              </Button>
            ) : null}
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setReductions([...reductions, { aggregation: "count", field: "" }])}>
          Add reduction
        </Button>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>Dynamic tags</legend>
        <p className="text-sm text-muted-foreground">
          Optional. Source fields copy a scalar onto the series. A path (for example <span className="font-mono">alarms[*].severity</span>)
          collects every string at that path; you choose how to pick one value (first, last, or a priority list). Each distinct tag
          combination is its own series. Use <span className="font-medium">Identity</span> for who/where. Use{" "}
          <span className="font-medium">Condition</span> for values that only exist while something is wrong so missing
          combinations write 0 and alerts can clear.
        </p>
        {dynamicTags.map((tag, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <input type="hidden" name="dynamicTagType" value={tag.type} />
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Kind</span>
              <select
                className={fieldClass}
                aria-label="Dynamic tag kind"
                value={tag.type}
                onChange={(event) => {
                  const next = [...dynamicTags];
                  next[index] =
                    event.target.value === "path"
                      ? {
                          type: "path",
                          tag: tag.type === "path" ? tag.tag : "",
                          path: "",
                          pick: "priority",
                          priority: "critical, warning, info",
                          whenEmptyMode: "value",
                          whenEmptyValue: "warning",
                          absent: tag.absent,
                        }
                      : { type: "field", name: tag.type === "field" ? tag.name : tag.tag, absent: tag.absent };
                  setDynamicTags(next);
                }}
              >
                <option value="field">Source field</option>
                <option value="path">Path → one value</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Series role</span>
              <select
                className={fieldClass}
                name="dynamicTagAbsent"
                aria-label="Dynamic tag series role"
                value={tag.absent}
                onChange={(event) => {
                  const next = [...dynamicTags];
                  next[index] = { ...tag, absent: event.target.value as AbsentMode };
                  setDynamicTags(next);
                }}
              >
                <option value="omit">Identity — omit when absent</option>
                <option value="zero">Condition — write 0 when absent</option>
              </select>
            </label>
            {tag.type === "field" ? (
              <>
                <input
                  className={fieldClass}
                  name="dynamicTagName"
                  aria-label="Dynamic tag field"
                  placeholder="Source field"
                  value={tag.name}
                  onChange={(event) => {
                    const next = [...dynamicTags];
                    next[index] = { type: "field", name: event.target.value, absent: tag.absent };
                    setDynamicTags(next);
                  }}
                />
                <input type="hidden" name="dynamicTagPath" value="" />
                <input type="hidden" name="dynamicTagPick" value="first" />
                <input type="hidden" name="dynamicTagPriority" value="" />
                <input type="hidden" name="dynamicTagWhenEmptyMode" value="omit" />
                <input type="hidden" name="dynamicTagWhenEmptyValue" value="" />
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Tag name</span>
                  <input
                    className={fieldClass}
                    name="dynamicTagName"
                    aria-label="Path dynamic tag name"
                    placeholder="alarm_severity"
                    value={tag.tag}
                    onChange={(event) => {
                      const next = [...dynamicTags];
                      next[index] = { ...tag, tag: event.target.value };
                      setDynamicTags(next);
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Path</span>
                  <input
                    className={`${fieldClass} font-mono`}
                    name="dynamicTagPath"
                    aria-label="Dynamic tag path"
                    placeholder="alarms[*].severity"
                    value={tag.path}
                    onChange={(event) => {
                      const next = [...dynamicTags];
                      next[index] = { ...tag, path: event.target.value };
                      setDynamicTags(next);
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Pick</span>
                  <select
                    className={fieldClass}
                    name="dynamicTagPick"
                    aria-label="Dynamic tag pick"
                    value={tag.pick}
                    onChange={(event) => {
                      const next = [...dynamicTags];
                      next[index] = { ...tag, pick: event.target.value as PathPickMode };
                      setDynamicTags(next);
                    }}
                  >
                    {pathPickModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === "first" ? "First value" : mode === "last" ? "Last value" : "Priority list"}
                      </option>
                    ))}
                  </select>
                </label>
                {tag.pick === "priority" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Priority (highest first, comma-separated)</span>
                    <input
                      className={fieldClass}
                      name="dynamicTagPriority"
                      aria-label="Dynamic tag priority"
                      placeholder="critical, warning, info"
                      value={tag.priority}
                      onChange={(event) => {
                        const next = [...dynamicTags];
                        next[index] = { ...tag, priority: event.target.value };
                        setDynamicTags(next);
                      }}
                    />
                  </label>
                ) : (
                  <input type="hidden" name="dynamicTagPriority" value={tag.priority} />
                )}
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>If none found</span>
                  <select
                    className={fieldClass}
                    name="dynamicTagWhenEmptyMode"
                    aria-label="Dynamic tag when empty mode"
                    value={tag.whenEmptyMode}
                    onChange={(event) => {
                      const next = [...dynamicTags];
                      next[index] = {
                        ...tag,
                        whenEmptyMode: event.target.value as "omit" | "value",
                      };
                      setDynamicTags(next);
                    }}
                  >
                    <option value="omit">Omit tag</option>
                    <option value="value">Use a value</option>
                  </select>
                </label>
                {tag.whenEmptyMode === "value" ? (
                  <input
                    className={fieldClass}
                    name="dynamicTagWhenEmptyValue"
                    aria-label="Dynamic tag when empty value"
                    placeholder="warning"
                    value={tag.whenEmptyValue}
                    onChange={(event) => {
                      const next = [...dynamicTags];
                      next[index] = { ...tag, whenEmptyValue: event.target.value };
                      setDynamicTags(next);
                    }}
                  />
                ) : (
                  <input type="hidden" name="dynamicTagWhenEmptyValue" value="" />
                )}
              </>
            )}
            {dynamicTags.length > 1 ? (
              <Button type="button" variant="outline" onClick={() => setDynamicTags(dynamicTags.filter((_, item) => item !== index))}>
                Remove dynamic tag
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setDynamicTags([...dynamicTags, { type: "field", name: "", absent: "omit" }])}
        >
          Add dynamic tag
        </Button>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>Static tags</legend>
        <input
          type="hidden"
          name="staticTagsJson"
          value={JSON.stringify(tags.filter((tag) => tag.key.trim() || tag.value.trim()))}
        />
        {tags.map((tag) => (
          <div key={tag.id} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={fieldClass}
                aria-label="Tag key"
                placeholder="Key"
                value={tag.key}
                onChange={(event) => {
                  setTags((current) =>
                    current.map((row) => (row.id === tag.id ? { ...row, key: event.target.value } : row)),
                  );
                }}
              />
              <input
                className={fieldClass}
                aria-label="Tag value"
                placeholder="Value"
                value={tag.value}
                onChange={(event) => {
                  setTags((current) =>
                    current.map((row) => (row.id === tag.id ? { ...row, value: event.target.value } : row)),
                  );
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTags((current) => {
                  const next = current.filter((row) => row.id !== tag.id);
                  return next.length > 0 ? next : [{ id: newTagId(), key: "", value: "" }];
                });
              }}
            >
              Remove tag
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setTags((current) => [...current, { id: newTagId(), key: "", value: "" }])}
        >
          Add tag
        </Button>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Preview window (seconds)</span>
        <input className={fieldClass} name="previewSeconds" type="number" min={1} step={1} required value={previewSeconds} onChange={(event) => setPreviewSeconds(event.target.value)} aria-label="Preview window (seconds)" />
        <span className="flex flex-wrap gap-2">
          {previewPresets.map((preset) => (
            <Button key={preset.seconds} type="button" variant="outline" onClick={() => setPreviewSeconds(preset.seconds)}>
              {preset.label}
            </Button>
          ))}
        </span>
      </label>
      {preview.ran ? <PreviewResult preview={preview} /> : null}
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" formAction={previewAction} disabled={pending || previewPending}>
          {previewPending ? "Previewing…" : "Preview"}
        </Button>
        <Button type="submit" disabled={pending || previewPending}>
          {pending ? "Saving…" : job?.id ? "Save changes" : job ? "Save copy" : "Save job"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Preview reads this many seconds back from now. It does not store a point.</p>
    </form>
  );
}

function draftReductions(job: JobFormJob | undefined): ReductionDraft[] {
  if (!job || job.reductions.length === 0) {
    return [{ aggregation: "count", field: "" }];
  }
  return job.reductions.map((reduction) => ({
    aggregation: aggregations.includes(reduction.aggregation as ReductionDraft["aggregation"]) ? (reduction.aggregation as ReductionDraft["aggregation"]) : "count",
    field: reduction.field ?? "",
  }));
}

function reductionMetricName(reduction: ReductionDraft): string {
  if (reduction.aggregation === "count") {
    return metricNameFor("count");
  }
  if (!reduction.field.trim()) {
    return "Needs a field";
  }
  return metricNameFor(reduction.aggregation, reduction.field);
}

function draftDynamicTags(job: JobFormJob | undefined): DynamicTagDraft[] {
  const tags = normalizeDynamicTags(job?.dynamicTags ?? []);
  if (tags.length === 0) {
    return [{ type: "field", name: "", absent: "omit" }];
  }
  return tags.map((tag) =>
    tag.type === "path"
      ? {
          type: "path" as const,
          tag: tag.tag,
          path: tag.path,
          pick: tag.pick,
          priority: tag.priority.join(", "),
          whenEmptyMode: tag.whenEmpty === null ? ("omit" as const) : ("value" as const),
          whenEmptyValue: tag.whenEmpty ?? "",
          absent: tag.absent,
        }
      : { type: "field" as const, name: tag.name, absent: tag.absent },
  );
}

type StaticTagDraft = { id: string; key: string; value: string };

function newTagId(): string {
  return crypto.randomUUID();
}

function draftTags(job: JobFormJob | undefined): StaticTagDraft[] {
  const entries = Object.entries(job?.staticTags ?? {});
  if (entries.length === 0) {
    return [{ id: newTagId(), key: "", value: "" }];
  }
  return entries.map(([key, value]) => ({ id: newTagId(), key, value }));
}

function queryHelp(sourceType: string | undefined): string {
  if (sourceType === "dynamodb") {
    return "Terms joined by AND. Include pk = the partition value. Other field = value terms keep only those rows. The window still limits the sort key.";
  }
  return "The query for this connection. Preview cannot run until this source has a connector.";
}

function scheduleTime(time: Date): string {
  return time.toISOString().slice(0, 19).replace("T", " ");
}

function SchedulePreview({
  now,
  windowMode,
  maxLookbackSeconds,
  schedule,
  intervalSeconds,
  cron,
}: {
  now: string;
  windowMode: WindowMode;
  maxLookbackSeconds: string;
  schedule: string;
  intervalSeconds: string;
  cron: string;
}) {
  const lookback = Number(maxLookbackSeconds);
  const interval = Number(intervalSeconds);
  if (!Number.isInteger(lookback) || lookback <= 0) {
    return null;
  }
  if (schedule === "cron" && cronError(cron)) {
    return <p className="text-sm text-destructive">{cronError(cron)}</p>;
  }
  const runs = upcomingRuns({
    now: new Date(now),
    count: 3,
    windowMode,
    maxLookbackSeconds: lookback,
    intervalSeconds: Number.isInteger(interval) && interval > 0 ? interval : 300,
    cron: schedule === "cron" ? cron : "",
  });
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {runs.map((run) => (
        <p key={run.runAt.toISOString()}>
          {scheduleTime(run.runAt)} · {scheduleTime(run.windowStart)} – {scheduleTime(run.windowEnd)}
        </p>
      ))}
    </div>
  );
}

function PreviewResult({ preview }: { preview: PreviewState }) {
  if (preview.error) {
    return <p className="text-sm text-destructive">{preview.error}</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
      <p>
        {preview.windowStart} – {preview.windowEnd}
      </p>
      {preview.warning ? <p className="text-destructive">{preview.warning}</p> : null}
      {preview.rows.length === 0 ? <p className="text-muted-foreground">No rows in this window.</p> : (
        <ul className="flex flex-col gap-1">
          {preview.rows.map((row) => (
            <li key={row.sk}>
              {row.sk} <span className="text-muted-foreground">{row.status}</span>
            </li>
          ))}
        </ul>
      )}
      {preview.rowCount > preview.rows.length ? (
        <p className="text-muted-foreground">Showing {preview.rows.length} of {preview.rowCount} rows.</p>
      ) : null}
      {preview.points.map((point) => (
        <p key={`${point.metricName}-${point.tags}`}>
          {point.metricName}: {point.value} <span className="text-muted-foreground">{point.tags}</span>
        </p>
      ))}
    </div>
  );
}
