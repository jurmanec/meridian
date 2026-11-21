import type { SourceConnector, SourcePoint, SourceRunContext } from "@/scheduler/source";
import { itemsInWindow, itemValue, readPartitionKey, reduceSnapshots, type SnapshotItem } from "./items";
import { queryPartitionItems } from "./query";
import { parseDynamoQuery } from "./selection";

export type ItemReader = (input: {
  config: Record<string, unknown>;
  secret: string;
  partitionKey: string;
  windowStart: Date;
  windowEnd: Date;
}) => Promise<SnapshotItem[]>;

export async function collectDynamo(
  context: SourceRunContext,
  readItems: ItemReader = queryPartitionItems,
): Promise<{ items: SnapshotItem[]; points: SourcePoint[] }> {
  const text = typeof context.query.text === "string" ? context.query.text : "";
  const selection = text.trim() ? parseDynamoQuery(text) : { partitionKey: readPartitionKey(context.query), equals: {} };
  const read = await readItems({
    config: context.connection.config,
    secret: context.connection.secret,
    partitionKey: selection.partitionKey,
    windowStart: context.windowStart,
    windowEnd: context.windowEnd,
  });
  const items = itemsInWindow(read, selection.partitionKey, context.windowStart, context.windowEnd).filter((item) =>
    Object.entries(selection.equals).every(([key, value]) => itemValue(item, key) === value),
  );
  return { items, points: reduceSnapshots(items, context.reductions, context.dynamicTags) };
}

export function createDynamoConnector(readItems?: ItemReader): SourceConnector {
  return {
    async run(context) {
      const { points } = await collectDynamo(context, readItems);
      return points;
    },
  };
}
