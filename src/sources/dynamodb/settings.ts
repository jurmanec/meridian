export type DynamoSettings = {
  tableName: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export function readDynamoSettings(config: Record<string, unknown>, secret: string): DynamoSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    parsed = null;
  }
  const credentials = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const tableName = requiredText(config, "tableName");
  const region = requiredText(config, "region");
  const endpoint = requiredText(config, "endpoint");
  const accessKeyId = requiredText(credentials, "accessKeyId");
  const secretAccessKey = requiredText(credentials, "secretAccessKey");

  if (!tableName || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("DynamoDB connection needs a table, region, and access key");
  }

  return {
    tableName,
    region,
    endpoint: endpoint || undefined,
    accessKeyId,
    secretAccessKey,
  };
}

export function redactSecret(message: string, settings: DynamoSettings): string {
  return message.split(settings.secretAccessKey).join("[redacted]").split(settings.accessKeyId).join("[redacted]");
}
