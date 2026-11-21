import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { formatSortBound, type SnapshotItem } from "./items";

export function snapshotItem(item: Record<string, unknown>): SnapshotItem {
  const fields: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "pk" || key === "sk") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      fields[key] = value;
    }
  }
  return {
    pk: String(item.pk ?? ""),
    sk: String(item.sk ?? ""),
    status: String(item.status ?? ""),
    fields,
    document: item,
  };
}
import { readDynamoSettings, redactSecret, type DynamoSettings } from "./settings";

// DynamoDB allows one condition on the sort key. BETWEEN includes the end, and the connector drops that row.
export function partitionQuery(tableName: string, partitionKey: string, windowStart: Date, windowEnd: Date): QueryCommandInput {
  return {
    TableName: tableName,
    KeyConditionExpression: "pk = :pk AND sk BETWEEN :start AND :end",
    ExpressionAttributeValues: {
      ":pk": partitionKey,
      ":start": formatSortBound(windowStart),
      ":end": formatSortBound(windowEnd),
    },
  };
}

export async function queryPartitionItems(input: {
  config: Record<string, unknown>;
  secret: string;
  partitionKey: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<SnapshotItem[]> {
  const settings = readDynamoSettings(input.config, input.secret);
  try {
    return await queryTable(settings, input.partitionKey, input.windowStart, input.windowEnd);
  } catch (error) {
    const message = error instanceof Error ? error.message : "DynamoDB query failed";
    throw new Error(`DynamoDB query failed: ${redactSecret(message, settings)}`);
  }
}

async function queryTable(settings: DynamoSettings, partitionKey: string, windowStart: Date, windowEnd: Date): Promise<SnapshotItem[]> {
  const base = new DynamoDBClient({
    region: settings.region,
    endpoint: settings.endpoint,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  const client = DynamoDBDocumentClient.from(base);
  const items: SnapshotItem[] = [];
  let exclusiveStartKey: QueryCommandInput["ExclusiveStartKey"];

  try {
    do {
      const page = await client.send(
        new QueryCommand({
          ...partitionQuery(settings.tableName, partitionKey, windowStart, windowEnd),
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of page.Items ?? []) {
        items.push(snapshotItem(item));
      }
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
  } finally {
    base.destroy();
  }

  return items;
}
