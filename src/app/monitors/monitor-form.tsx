"use client";

import { useActionState, useLayoutEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  defaultSeverityMap,
  normalizeSeverityConfig,
  severityLevels,
  type SeverityConfig,
  type SeverityLevel,
  type SeverityMissingMode,
  type SeverityMode,
} from "@/db/severity";
import { fieldClass, labelClass } from "@/lib/fields";
import { applySelection, differingTags, sharedMetrics, type JobOption, type TagSelector } from "@/monitor/selection";
import { createMonitorAction, updateMonitorAction, type FormState } from "./actions";

const initialState: FormState = { error: "" };

type Step = "select" | "condition" | "notify";
type Mode = "jobs" | "filters" | "both";

const steps: { id: Step; label: string }[] = [
  { id: "select", label: "Select data" },
  { id: "condition", label: "Condition" },
  { id: "notify", label: "Notifications" },
];

export type MonitorDraft = {
  id: string;
  name: string;
  jobIds: string[];
  metricName: string;
  tagFilter: Record<string, string[]>;
  threshold: number;
  consecutivePoints: number;
  severity: SeverityConfig | string;
  team: string;
  manualUrl: string;
  notifyMode: "slack" | "webhook";
};

type MapRow = { id: string; from: string; to: SeverityLevel };

type SeverityDraft = {
  mode: SeverityMode;
  fixed: SeverityLevel;
  tag: string;
  map: MapRow[];
  whenMissing: SeverityMissingMode;
};

export function MonitorForm({
  jobs,
  monitor,
  defaultAlertWebhook = "",
}: {
  jobs: JobOption[];
  monitor?: MonitorDraft;
  /** Prefill for new monitors when creating with alert webhook (e.g. from P8_ALERT_URL). */
  defaultAlertWebhook?: string;
}) {
  const submit = useMemo(() => (monitor ? updateMonitorAction.bind(null, monitor.id) : createMonitorAction), [monitor]);
  const [state, action, pending] = useActionState(submit, initialState);
  const [step, setStep] = useState<Step>("select");
  const [name, setName] = useState(monitor?.name ?? "");
  const [mode, setMode] = useState<Mode>("both");
  const [selectors, setSelectors] = useState<TagSelector[]>(selectorsFromFilter(monitor?.tagFilter));
  const [jobName, setJobName] = useState("");
  const [metricQuery, setMetricQuery] = useState(monitor?.metricName ?? "");
  const [applied, setApplied] = useState<{ tags: TagSelector[]; jobName: string; metricName: string } | null>(null);
  const [filterError, setFilterError] = useState("");
  const [selected, setSelected] = useState<string[]>(monitor?.jobIds ?? []);
  const [metricName, setMetricName] = useState(monitor?.metricName ?? "");
  const [conditionFilters, setConditionFilters] = useState(filtersFromMonitor(monitor));
  const [threshold, setThreshold] = useState(monitor ? String(monitor.threshold) : "1");
  const [consecutivePoints, setConsecutivePoints] = useState(monitor ? String(monitor.consecutivePoints) : "1");
  const [severity, setSeverity] = useState<SeverityDraft>(() => draftSeverity(monitor?.severity));
  const [team, setTeam] = useState(monitor?.team ?? "");
  const [manualUrl, setManualUrl] = useState(monitor?.manualUrl ?? "");
  const [notifyMode, setNotifyMode] = useState<"slack" | "webhook">(monitor?.notifyMode ?? "webhook");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [alertWebhook, setAlertWebhook] = useState(monitor ? "" : defaultAlertWebhook);
  const [localError, setLocalError] = useState("");

  useLayoutEffect(() => {
    if (!monitor) {
      return;
    }
    setName(monitor.name);
    setMode("both");
    setSelectors(selectorsFromFilter(monitor.tagFilter));
    setMetricQuery(monitor.metricName);
    setSelected(monitor.jobIds);
    setMetricName(monitor.metricName);
    setConditionFilters(filtersFromMonitor(monitor));
    setThreshold(String(monitor.threshold));
    setConsecutivePoints(String(monitor.consecutivePoints));
    setSeverity(draftSeverity(monitor.severity));
    setTeam(monitor.team);
    setManualUrl(monitor.manualUrl);
    setNotifyMode(monitor.notifyMode);
    setSlackWebhook("");
    setAlertWebhook("");
  }, [monitor]);

  const selection = applied ? applySelection(jobs, applied) : { error: "", matches: jobs.map((job) => ({ job, warning: "" })) };
  const matches = applied ? selection.matches : [];
  const chosen = jobs.filter((job) => selected.includes(job.id));
  const metrics = sharedMetrics(chosen);
  const visible = visibleJobs(mode, jobs, matches, applied !== null);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((jobId) => jobId !== id) : [...current, id]));
  }

  function applyFilters() {
    const next = { tags: selectors, jobName, metricName: metricQuery };
    const result = applySelection(jobs, next);
    setFilterError(result.error);
    if (result.error) {
      return;
    }
    setApplied(next);
    const matching = new Set(result.matches.filter((match) => match.warning.length === 0).map((match) => match.job.id));
    setSelected((current) => [...new Set([...current, ...matching])]);
  }

  function clearFilters() {
    setSelectors([{ key: "", match: "equals", value: "" }]);
    setJobName("");
    setMetricQuery("");
    setApplied(null);
    setFilterError("");
  }

  function continueToCondition() {
    if (name.trim().length === 0) {
      setLocalError("Name is required.");
      return;
    }
    if (chosen.length === 0) {
      setLocalError("Select a job.");
      return;
    }
    if (metrics.length === 0) {
      setLocalError("These jobs do not share a metric.");
      return;
    }
    setLocalError("");
    setMetricName((current) => (metrics.includes(current) ? current : metrics[0] ?? ""));
    const sameJobs = monitor && sameIdList(selected, monitor.jobIds);
    if (!sameJobs) {
      const prefill = differingTags(chosen);
      const rows = Object.entries(prefill).map(([key, values]) => ({ key, values: values.join(", ") }));
      setConditionFilters(rows.length > 0 ? rows : [{ key: "", values: "" }]);
    }
    setStep("condition");
  }

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-6">
      <input type="hidden" name="name" value={name} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="jobId" value={id} />
      ))}
      <input type="hidden" name="metricName" value={metricName} />
      <input type="hidden" name="threshold" value={threshold} />
      <input type="hidden" name="consecutivePoints" value={consecutivePoints} />
      {conditionFilters.map((filter, index) => (
        <span key={index} hidden>
          <input name="tagKey" value={filter.key} readOnly />
          <input name="tagValue" value={filter.values} readOnly />
        </span>
      ))}
      <ol className="flex flex-wrap gap-3 text-sm">
        {steps.map((item, index) => (
          <li key={item.id} className={item.id === step ? "font-medium" : "text-muted-foreground"}>
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      {step === "select" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Select data for this monitor</h2>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Monitor name</span>
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
          </label>
          <div className="flex gap-2" role="tablist" aria-label="Selection method">
            {(["jobs", "filters", "both"] as const).map((item) => (
              <Button key={item} type="button" variant={mode === item ? "default" : "outline"} onClick={() => setMode(item)} aria-pressed={mode === item}>
                {item === "jobs" ? "Jobs" : item === "filters" ? "Filters" : "Both"}
              </Button>
            ))}
          </div>
          {mode !== "jobs" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className={labelClass}>Add filter</legend>
              {selectors.map((selector, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr]">
                  <input className={fieldClass} aria-label="Tag key" placeholder="Tag key" value={selector.key} onChange={(event) => updateSelector(setSelectors, index, { key: event.target.value })} />
                  <select className={fieldClass} aria-label="Match type" value={selector.match} onChange={(event) => updateSelector(setSelectors, index, { match: event.target.value === "regex" ? "regex" : "equals" })}>
                    <option value="equals">equals</option>
                    <option value="regex">regex</option>
                  </select>
                  <input className={fieldClass} aria-label="Value" placeholder="Value" value={selector.value} onChange={(event) => updateSelector(setSelectors, index, { value: event.target.value })} />
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setSelectors([...selectors, { key: "", match: "equals", value: "" }])}>
                Add filter
              </Button>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Job name contains</span>
                <input className={fieldClass} value={jobName} onChange={(event) => setJobName(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Metric name</span>
                <input className={fieldClass} value={metricQuery} onChange={(event) => setMetricQuery(event.target.value)} />
              </label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={applyFilters}>
                  Apply filters
                </Button>
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Clear
                </Button>
              </div>
              {filterError ? <p className="text-sm text-destructive">{filterError}</p> : null}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{listCaption(mode, visible.length, applied !== null)}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const pool = applied ? matches : visible;
                    setSelected((current) => [...new Set([...current, ...pool.filter((row) => row.warning.length === 0).map((row) => row.job.id)])]);
                  }}
                >
                  Select all matching
                </Button>
                <Button type="button" variant="outline" onClick={() => setSelected([])}>
                  Clear selection
                </Button>
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">{applied ? "No jobs match. Remove a filter." : "Apply filters to see matching jobs."}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {visible.map((row) => (
                  <li key={row.job.id} className={`flex gap-3 px-4 py-3 ${row.warning ? "text-muted-foreground" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={row.job.name}
                      checked={selected.includes(row.job.id)}
                      disabled={row.warning.length > 0}
                      onChange={() => toggle(row.job.id)}
                    />
                    <span className="flex flex-col gap-1 text-sm">
                      <span className="font-medium text-foreground">{row.job.name}</span>
                      <span className="text-muted-foreground">Produces: {row.job.metrics.join(", ") || "None"}</span>
                      <span className="text-muted-foreground">Tags: {formatTags(row.job.staticTags)}</span>
                      {row.warning ? <span>{row.warning}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 text-sm">
            <p>Selected: {chosen.length} {chosen.length === 1 ? "job" : "jobs"}</p>
            <p>Metrics available: {metrics.join(", ") || "None"}</p>
            <span className="w-fit rounded-md border border-border px-2 py-0.5">Resolved selection</span>
            <Button type="button" onClick={continueToCondition}>
              Continue to condition
            </Button>
          </div>
        </section>
      ) : null}

      {step === "condition" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Condition</h2>
          <span className="w-fit rounded-md border border-border px-2 py-0.5 text-sm">Resolved selection</span>
          <p className="text-sm text-muted-foreground">Jobs: {chosen.map((job) => job.name).join(", ")}</p>
          <Button type="button" variant="outline" onClick={() => setStep("select")}>
            Change
          </Button>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Metric</span>
            <select className={fieldClass} value={metricName} onChange={(event) => setMetricName(event.target.value)}>
              {metrics.map((metric) => (
                <option key={metric} value={metric}>
                  {metric}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-3">
            <legend className={labelClass}>Tag filter</legend>
            <p className="text-sm text-muted-foreground">A series matches when each key is one of its values. Leave a row blank to watch every series.</p>
            {conditionFilters.map((filter, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <input className={fieldClass} aria-label="Tag key" placeholder="Key" value={filter.key} onChange={(event) => updateCondition(setConditionFilters, index, { key: event.target.value })} />
                <input className={fieldClass} aria-label="Allowed values" placeholder="any of" value={filter.values} onChange={(event) => updateCondition(setConditionFilters, index, { values: event.target.value })} />
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setConditionFilters([...conditionFilters, { key: "", values: "" }])}>
              Add filter
            </Button>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Threshold</span>
            <input className={fieldClass} type="number" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} required />
            <span className="text-sm text-muted-foreground">Alert when every required point is at or above this number.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Consecutive points</span>
            <input className={fieldClass} type="number" min={1} step={1} value={consecutivePoints} onChange={(event) => setConsecutivePoints(event.target.value)} required />
            <span className="text-sm text-muted-foreground">Fire after this many latest points are all at or above the threshold.</span>
          </label>
          <Button type="button" onClick={() => setStep("notify")}>
            Continue to notifications
          </Button>
        </section>
      ) : null}

      {step === "notify" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <Button type="button" variant="outline" onClick={() => setStep("condition")}>
            Back
          </Button>
          <fieldset className="flex flex-col gap-3">
            <legend className={labelClass}>Severity</legend>
            <input type="hidden" name="severityJson" value={JSON.stringify(severityPayload(severity))} />
            <select
              className={fieldClass}
              aria-label="Severity mode"
              value={severity.mode}
              onChange={(event) => {
                const mode = event.target.value as SeverityMode;
                setSeverity((current) => ({
                  ...current,
                  mode,
                  map: current.map.length > 0 ? current.map : identityMapRows(),
                }));
              }}
            >
              <option value="unset">None</option>
              <option value="fixed">Fixed</option>
              <option value="from_tag">From series tag</option>
            </select>
            {severity.mode === "fixed" ? (
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Value</span>
                <select
                  className={fieldClass}
                  aria-label="Fixed severity"
                  value={severity.fixed}
                  onChange={(event) => setSeverity((current) => ({ ...current, fixed: event.target.value as SeverityLevel }))}
                >
                  {severityLevels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {severity.mode === "from_tag" ? (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Tag name</span>
                  <input
                    className={fieldClass}
                    aria-label="Severity tag name"
                    placeholder="Tag name"
                    value={severity.tag}
                    onChange={(event) => setSeverity((current) => ({ ...current, tag: event.target.value }))}
                  />
                </label>
                <fieldset className="flex flex-col gap-2">
                  <legend className={labelClass}>Map tag values</legend>
                  {severity.map.map((row) => (
                    <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        className={fieldClass}
                        aria-label="Tag value"
                        placeholder="Tag value"
                        value={row.from}
                        onChange={(event) =>
                          setSeverity((current) => ({
                            ...current,
                            map: current.map.map((item) => (item.id === row.id ? { ...item, from: event.target.value } : item)),
                          }))
                        }
                      />
                      <select
                        className={fieldClass}
                        aria-label="Mapped severity"
                        value={row.to}
                        onChange={(event) =>
                          setSeverity((current) => ({
                            ...current,
                            map: current.map.map((item) =>
                              item.id === row.id ? { ...item, to: event.target.value as SeverityLevel } : item,
                            ),
                          }))
                        }
                      >
                        {severityLevels.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setSeverity((current) => ({
                            ...current,
                            map: current.map.filter((item) => item.id !== row.id),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setSeverity((current) => ({
                        ...current,
                        map: [...current.map, { id: newMapId(), from: "", to: "warning" }],
                      }))
                    }
                  >
                    Add mapping
                  </Button>
                </fieldset>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>When tag missing or unmapped</span>
                  <select
                    className={fieldClass}
                    aria-label="When severity tag missing"
                    value={severity.whenMissing}
                    onChange={(event) =>
                      setSeverity((current) => ({
                        ...current,
                        whenMissing: event.target.value === "fixed" ? "fixed" : "omit",
                      }))
                    }
                  >
                    <option value="omit">Omit severity</option>
                    <option value="fixed">Use fixed fallback</option>
                  </select>
                </label>
                {severity.whenMissing === "fixed" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Fallback</span>
                    <select
                      className={fieldClass}
                      aria-label="Fallback severity"
                      value={severity.fixed}
                      onChange={(event) => setSeverity((current) => ({ ...current, fixed: event.target.value as SeverityLevel }))}
                    >
                      {severityLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            <span className="text-sm text-muted-foreground">
              Page severity for alerts. Fixed sets one value. From series tag maps a dynamic tag on the series to critical, warning, or info when the monitor fires.
            </span>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Team</span>
            <input className={fieldClass} name="team" autoComplete="off" placeholder="Optional" value={team} onChange={(event) => setTeam(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Manual URL</span>
            <input className={fieldClass} name="manualUrl" type="url" autoComplete="off" placeholder="Optional" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Notify via</span>
            <select
              className={fieldClass}
              name="notifyMode"
              value={notifyMode}
              onChange={(event) => setNotifyMode(event.target.value === "webhook" ? "webhook" : "slack")}
            >
              <option value="webhook">Alert webhook</option>
              <option value="slack">Slack</option>
            </select>
            <span className="text-sm text-muted-foreground">
              {notifyMode === "webhook"
                ? "Primary path: POST a structured alert payload (open / update / resolve) to this URL. Does not post to Slack."
                : "Secondary option: post the alert message to a Slack incoming webhook."}
            </span>
          </label>
          {notifyMode === "slack" ? (
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Slack webhook</span>
              <input
                className={fieldClass}
                name="slackWebhook"
                type="url"
                required={!monitor}
                autoComplete="off"
                value={slackWebhook}
                onChange={(event) => setSlackWebhook(event.target.value)}
              />
              {monitor ? <span className="text-sm text-muted-foreground">Leave blank to keep the stored webhook.</span> : null}
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Alert webhook</span>
              <input
                className={fieldClass}
                name="alertWebhook"
                type="url"
                required={!monitor}
                autoComplete="off"
                placeholder="http://127.0.0.1:8787"
                value={alertWebhook}
                onChange={(event) => setAlertWebhook(event.target.value)}
              />
              {monitor ? <span className="text-sm text-muted-foreground">Leave blank to keep the stored webhook.</span> : null}
            </label>
          )}
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : monitor ? "Save changes" : "Save monitor"}
          </Button>
        </section>
      ) : null}
      {localError && step === "select" ? <p className="text-sm text-destructive">{localError}</p> : null}
    </form>
  );
}

function selectorsFromFilter(filter: Record<string, string[]> | undefined): TagSelector[] {
  const rows = Object.entries(filter ?? {}).map(([key, values]) =>
    values.length > 1
      ? { key, match: "regex" as const, value: `^(?:${values.map(escapeRegex).join("|")})$` }
      : { key, match: "equals" as const, value: values[0] ?? "" },
  );
  return rows.length > 0 ? rows : [{ key: "", match: "equals", value: "" }];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filtersFromMonitor(monitor: MonitorDraft | undefined): { key: string; values: string }[] {
  const rows = Object.entries(monitor?.tagFilter ?? {}).map(([key, values]) => ({ key, values: values.join(", ") }));
  return rows.length > 0 ? rows : [{ key: "", values: "" }];
}

function sameIdList(left: string[], right: string[]): boolean {
  return [...left].sort().join() === [...right].sort().join();
}

function visibleJobs(mode: Mode, jobs: JobOption[], matches: { job: JobOption; warning: string }[], applied: boolean) {
  if (mode === "jobs" || (mode === "both" && !applied)) {
    return jobs.map((job) => ({ job, warning: "" }));
  }
  if (mode === "filters") {
    return matches;
  }
  const matched = new Map(matches.map((match) => [match.job.id, match.warning]));
  const listed = matches.map((match) => ({ job: match.job, warning: match.warning }));
  const others = jobs.filter((job) => !matched.has(job.id)).map((job) => ({ job, warning: "" }));
  return [...listed, ...others];
}

function listCaption(mode: Mode, count: number, applied: boolean): string {
  if (mode === "filters" && !applied) {
    return "Filters are not applied";
  }
  return `${count} ${count === 1 ? "job" : "jobs"} shown`;
}

function formatTags(tags: Record<string, string>): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) {
    return "None";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function updateSelector(setSelectors: (value: TagSelector[] | ((current: TagSelector[]) => TagSelector[])) => void, index: number, patch: Partial<TagSelector>) {
  setSelectors((current) => current.map((selector, item) => (item === index ? { ...selector, ...patch } : selector)));
}

function updateCondition(
  setFilters: (value: { key: string; values: string }[] | ((current: { key: string; values: string }[]) => { key: string; values: string }[])) => void,
  index: number,
  patch: Partial<{ key: string; values: string }>,
) {
  setFilters((current) => current.map((filter, item) => (item === index ? { ...filter, ...patch } : filter)));
}

function newMapId(): string {
  return crypto.randomUUID();
}

function identityMapRows(): MapRow[] {
  return Object.entries(defaultSeverityMap()).map(([from, to]) => ({ id: newMapId(), from, to }));
}

function draftSeverity(input: SeverityConfig | string | undefined): SeverityDraft {
  const config = normalizeSeverityConfig(input);
  if (config.mode === "fixed") {
    return {
      mode: "fixed",
      fixed: config.fixed,
      tag: "",
      map: identityMapRows(),
      whenMissing: "omit",
    };
  }
  if (config.mode === "from_tag") {
    const rows = Object.entries(config.map).map(([from, to]) => ({ id: newMapId(), from, to }));
    return {
      mode: "from_tag",
      fixed: config.fixed ?? "info",
      tag: config.tag,
      map: rows.length > 0 ? rows : identityMapRows(),
      whenMissing: config.whenMissing,
    };
  }
  return {
    mode: "unset",
    fixed: "critical",
    tag: "",
    map: identityMapRows(),
    whenMissing: "omit",
  };
}

function severityPayload(draft: SeverityDraft): SeverityConfig {
  if (draft.mode === "unset") {
    return { mode: "unset" };
  }
  if (draft.mode === "fixed") {
    return { mode: "fixed", fixed: draft.fixed };
  }
  const map: Record<string, SeverityLevel> = {};
  for (const row of draft.map) {
    const from = row.from.trim();
    if (!from) {
      continue;
    }
    map[from] = row.to;
  }
  if (draft.whenMissing === "fixed") {
    return { mode: "from_tag", tag: draft.tag.trim(), map, whenMissing: "fixed", fixed: draft.fixed };
  }
  return { mode: "from_tag", tag: draft.tag.trim(), map, whenMissing: "omit" };
}
