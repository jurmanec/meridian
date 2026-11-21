import { expect, test } from "vitest";
import { parseDynamoQuery } from "./selection";

test("a query supplies the partition and any equality terms", () => {
  expect(parseDynamoQuery('pk = "HALL" AND status = FAULTED')).toEqual({
    partitionKey: "HALL",
    equals: { status: "FAULTED" },
  });
});

test("a query without pk cannot run", () => {
  expect(() => parseDynamoQuery("status = FAULTED")).toThrow(/pk = value/);
});
