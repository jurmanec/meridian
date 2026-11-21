export type DynamoSelection = {
  partitionKey: string;
  equals: Record<string, string>;
};

export function parseDynamoQuery(text: string): DynamoSelection {
  const clauses = text
    .split(/\s+AND\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  if (clauses.length === 0) {
    throw new Error("A query is required.");
  }

  const equals: Record<string, string> = {};
  for (const clause of clauses) {
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))$/.exec(clause);
    if (!match) {
      throw new Error("Each query term is field = value.");
    }
    const field = match[1] ?? "";
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (field in equals) {
      throw new Error("Query fields must be unique.");
    }
    equals[field] = value;
  }

  const partitionKey = equals.pk;
  if (!partitionKey) {
    throw new Error("A DynamoDB query needs pk = value.");
  }
  delete equals.pk;
  return { partitionKey, equals };
}
