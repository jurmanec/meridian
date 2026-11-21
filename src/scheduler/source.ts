import type { DynamicTag, Tags } from "@/db/schema";

export type SourcePoint = {
  metricName: string;
  value: number;
  tags: Tags;
};

export type SourceRunContext = {
  sourceType: string;
  query: Record<string, unknown>;
  reductions: { aggregation: string; metricName: string; field?: string | null; filter?: Record<string, unknown> | null }[];
  dynamicTags: DynamicTag[];
  staticTags: Tags;
  windowStart: Date;
  windowEnd: Date;
  connection: {
    config: Record<string, unknown>;
    secret: string;
  };
};

export type SourceConnector = {
  run(context: SourceRunContext): Promise<SourcePoint[]>;
};

export type ConnectorRegistry = ReadonlyMap<string, SourceConnector>;

export const RETRY_ATTEMPTS = 3;
