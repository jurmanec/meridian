import { expect, test } from "vitest";
import { partitionQuery } from "./query";
import { readDynamoSettings, redactSecret } from "./settings";

test("the query bound is half-open on the sort key", () => {
  const query = partitionQuery("snapshots", "ASSET-1", new Date("2026-11-13T16:00:00.000Z"), new Date("2026-11-13T16:05:00.000Z"));

  expect(query.KeyConditionExpression).toBe("pk = :pk AND sk BETWEEN :start AND :end");
  expect(query.ExpressionAttributeValues).toEqual({
    ":pk": "ASSET-1",
    ":start": "2026-11-13T16:00:00.000000000Z",
    ":end": "2026-11-13T16:05:00.000000000Z",
  });
});

test("a connection needs a table, region, and access key", () => {
  expect(() => readDynamoSettings({}, "not-json")).toThrow(/table, region, and access key/);

  const settings = readDynamoSettings(
    { tableName: "snapshots", region: "us-east-1", endpoint: "http://127.0.0.1:8000" },
    JSON.stringify({ accessKeyId: "local-key", secretAccessKey: "local-secret" }),
  );
  expect(settings.tableName).toBe("snapshots");
  expect(settings.endpoint).toBe("http://127.0.0.1:8000");
  expect(redactSecret("local-key failed with local-secret", settings)).toBe("[redacted] failed with [redacted]");
});
