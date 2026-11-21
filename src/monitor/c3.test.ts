import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  buildAlertKey,
  buildC3AlertEvent,
  identityTagsFrom,
  postC3Alert,
  resolveP8AlertUrl,
  tagDigest,
  type C3AlertEvent,
} from "./c3";

test("tag digest matches SHA-256 of compact lexicographic JSON", () => {
  const tags = { hall_id: "HALL-01", asset_id: "ROOM-01", alarm_severity: "warning" };
  const expected = createHash("sha256")
    .update(JSON.stringify({ alarm_severity: "warning", asset_id: "ROOM-01", hall_id: "HALL-01" }), "utf8")
    .digest("hex")
    .slice(0, 16);
  expect(tagDigest(tags)).toBe(expected);
  expect(tagDigest(tags)).toBe("a0f87b2057b3eb10");
});

test("alert_key digests identity tags, ignoring condition values", () => {
  const identityDigest = createHash("sha256")
    .update(JSON.stringify({ asset_id: "ROOM-01", hall_id: "HALL-01" }), "utf8")
    .digest("hex")
    .slice(0, 16);
  expect(identityDigest).toBe("c8cd54af466e6351");

  const warning = { alarm_severity: "warning", asset_id: "ROOM-01", hall_id: "HALL-01" };
  const critical = { alarm_severity: "critical", asset_id: "ROOM-01", hall_id: "HALL-01" };
  const conditionKeys = ["alarm_severity"];
  expect(buildAlertKey("mon-dc-building", "job-room-01", warning, conditionKeys)).toBe(
    "mon-dc-building:job-room-01:c8cd54af466e6351",
  );
  expect(buildAlertKey("mon-dc-building", "job-room-01", critical, conditionKeys)).toBe(
    buildAlertKey("mon-dc-building", "job-room-01", warning, conditionKeys),
  );
  expect(buildAlertKey("mon-dc-building", "job-room-01", warning)).toBe(
    "mon-dc-building:job-room-01:a0f87b2057b3eb10",
  );
});

test("identity tags drop condition keys", () => {
  expect(
    identityTagsFrom(
      { alarm_severity: "critical", asset_id: "ROOM-01", hall_id: "HALL-01" },
      ["alarm_severity"],
    ),
  ).toEqual({ asset_id: "ROOM-01", hall_id: "HALL-01" });
});

test("buildC3AlertEvent shapes FIRING and RESOLVED with shared alert_key", () => {
  const tags = { alarm_severity: "warning", asset_id: "ROOM-01", hall_id: "HALL-01" };
  const firedAt = new Date("2026-11-14T22:05:42.335Z");
  const common = {
    monitorId: "mon-1",
    monitorName: "Data Center Building Monitor",
    jobId: "job-1",
    tags,
    conditionTagKeys: ["alarm_severity"],
    metricName: "row_count",
    threshold: 1,
    consecutivePoints: 1,
    windowStart: new Date("2026-11-13T22:05:42.335Z"),
    windowEnd: new Date("2026-11-14T22:05:42.335Z"),
    team: "facility-ops",
    manualUrl: "https://example.test/runbook",
    severity: "warning" as const,
    firedAt,
  };

  const firing = buildC3AlertEvent({
    ...common,
    transition: "firing",
    value: 1,
    emittedAt: firedAt,
    eventId: "11111111-1111-4111-8111-111111111101",
  });
  expect(firing).toMatchObject({
    contract: "p8.alert",
    version: "0.3",
    transition: "FIRING",
    resolved_at: null,
    severity: "warning",
    team: "facility-ops",
    source: "p2",
    labels: tags,
    identity_tags: { asset_id: "ROOM-01", hall_id: "HALL-01" },
    details: {
      monitor_id: "mon-1",
      monitor_name: "Data Center Building Monitor",
      job_id: "job-1",
      condition_tag_keys: ["alarm_severity"],
      metric_name: "row_count",
      value: 1,
    },
  });
  expect(firing.alert_key).toBe(buildAlertKey("mon-1", "job-1", tags, ["alarm_severity"]));
  expect(firing).not.toHaveProperty("monitor_id");
  expect(firing).not.toHaveProperty("time_series_tags");
  expect(firing).not.toHaveProperty("condition_tag_keys");

  const critical = buildC3AlertEvent({
    ...common,
    tags: { alarm_severity: "critical", asset_id: "ROOM-01", hall_id: "HALL-01" },
    transition: "firing",
    value: 2,
    severity: "critical",
    emittedAt: new Date("2026-11-14T23:01:00.000Z"),
    eventId: "22222222-2222-4222-8222-222222222201",
  });
  expect(critical.alert_key).toBe(firing.alert_key);
  expect(critical.severity).toBe("critical");

  const resolvedAt = new Date("2026-11-14T22:18:15.120Z");
  const resolved = buildC3AlertEvent({
    ...common,
    transition: "resolved",
    value: 0,
    emittedAt: resolvedAt,
    eventId: "11111111-1111-4111-8111-111111111102",
  });
  expect(resolved.alert_key).toBe(firing.alert_key);
  expect(resolved.transition).toBe("RESOLVED");
  expect(resolved.fired_at).toBe(firedAt.toISOString());
  expect(resolved.resolved_at).toBe(resolvedAt.toISOString());
  expect(resolved.details.value).toBe(0);
});

test("omit unset severity and blank team / manual_url", () => {
  const event = buildC3AlertEvent({
    monitorId: "mon-1",
    monitorName: "m",
    jobId: "job-1",
    transition: "firing",
    tags: { asset_id: "A-1" },
    conditionTagKeys: [],
    value: 1,
    metricName: "row_count",
    threshold: 1,
    consecutivePoints: 1,
    windowStart: new Date("2026-11-14T00:00:00.000Z"),
    windowEnd: new Date("2026-11-14T00:01:00.000Z"),
    team: "  ",
    manualUrl: "",
    severity: null,
    firedAt: new Date("2026-11-14T00:01:00.000Z"),
  });
  expect(event.severity).toBeUndefined();
  expect(event.team).toBeUndefined();
  expect(event.manual_url).toBeUndefined();
  expect(event.identity_tags).toBeUndefined();
  expect(event.details.condition_tag_keys).toBeUndefined();
  expect(event.labels).toEqual({ asset_id: "A-1" });
});

test("resolveP8AlertUrl appends /v1/alerts", () => {
  expect(resolveP8AlertUrl(null)).toBeNull();
  expect(resolveP8AlertUrl("")).toBeNull();
  expect(resolveP8AlertUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/v1/alerts");
  expect(resolveP8AlertUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787/v1/alerts");
  expect(resolveP8AlertUrl("http://127.0.0.1:8787/v1/alerts")).toBe("http://127.0.0.1:8787/v1/alerts");
});

test("postC3Alert accepts 202 and 200; does not retry 400", async () => {
  const event = buildC3AlertEvent({
    monitorId: "mon-1",
    monitorName: "m",
    jobId: "job-1",
    transition: "firing",
    tags: { asset_id: "A-1" },
    conditionTagKeys: [],
    value: 1,
    metricName: "row_count",
    threshold: 1,
    consecutivePoints: 1,
    windowStart: new Date("2026-11-14T00:00:00.000Z"),
    windowEnd: new Date("2026-11-14T00:01:00.000Z"),
    team: "",
    manualUrl: "",
    severity: "warning",
    firedAt: new Date("2026-11-14T00:01:00.000Z"),
    eventId: "evt-1",
  });

  const ok = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", ok);
  await postC3Alert(event, "http://p8.test");
  expect(ok).toHaveBeenCalledOnce();
  const [, init] = ok.mock.calls[0] as [string, RequestInit];
  expect(init.headers).toMatchObject({
    "content-type": "application/json",
    "x-p8-event-id": "evt-1",
  });

  const dup = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", dup);
  await postC3Alert(event, "http://p8.test/v1/alerts");

  const bad = vi.fn(async () => new Response("nope", { status: 400 }));
  vi.stubGlobal("fetch", bad);
  await expect(postC3Alert(event, "http://p8.test")).rejects.toThrow(/rejected/);
  expect(bad).toHaveBeenCalledOnce();

  vi.unstubAllGlobals();
});

test("postC3Alert retries 5xx then succeeds", async () => {
  const event = {
    event_id: "evt-retry",
  } as C3AlertEvent;
  // Minimal body for fetch; postC3Alert only needs event_id in headers + JSON body
  Object.assign(
    event,
    buildC3AlertEvent({
      monitorId: "mon-1",
      monitorName: "m",
      jobId: "job-1",
      transition: "firing",
      tags: { asset_id: "A-1" },
      conditionTagKeys: [],
      value: 1,
      metricName: "row_count",
      threshold: 1,
      consecutivePoints: 1,
      windowStart: new Date("2026-11-14T00:00:00.000Z"),
      windowEnd: new Date("2026-11-14T00:01:00.000Z"),
      team: "",
      manualUrl: "",
      severity: "info",
      firedAt: new Date("2026-11-14T00:01:00.000Z"),
      eventId: "evt-retry",
    }),
  );

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  await postC3Alert(event, "http://p8.test");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});
