import { expect, test } from "vitest";
import { latestCronSlot, nextCronSlot } from "./cron";

const now = new Date("2026-11-13T16:07:30.000Z");

test("a five-field cron finds the surrounding utc minutes", () => {
  expect(latestCronSlot("*/5 * * * *", now)?.toISOString()).toBe("2026-11-13T16:05:00.000Z");
  expect(nextCronSlot("*/5 * * * *", now).toISOString()).toBe("2026-11-13T16:10:00.000Z");
});
