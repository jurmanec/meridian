import { getDb } from "@/db/client";
import { createDynamoConnector } from "@/sources/dynamodb/connector";
import { runDueJobs } from "./run-due";

const connectors = new Map([["dynamodb", createDynamoConnector()]]);

const tickMs = 1000;

const globalForScheduler = globalThis as typeof globalThis & { schedulerStarted?: boolean };

export function startScheduler(): void {
  if (globalForScheduler.schedulerStarted) {
    return;
  }
  globalForScheduler.schedulerStarted = true;
  setInterval(() => {
    void runDueJobs(getDb(), new Date(), connectors).catch((error: unknown) => {
      console.error("scheduler tick failed", error);
    });
  }, tickMs);
}
