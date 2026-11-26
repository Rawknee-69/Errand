import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { connectors } from "../db/schema.ts";

export const DEFAULT_MAX_CONNECTORS_PER_USER = 10;

export class ConnectorLimitError extends Error {
  readonly count: number;
  readonly limit: number;

  constructor(count: number, limit: number) {
    super(`Connector limit reached: ${count} of ${limit} connectors in use`);
    this.name = "ConnectorLimitError";
    this.count = count;
    this.limit = limit;
  }
}

export function countConnectors(db: Db, userId: string): number {
  const row = db
    .select({ value: count() })
    .from(connectors)
    .where(eq(connectors.userId, userId))
    .all()[0];
  return row?.value ?? 0;
}

export function assertConnectorQuota(
  db: Db,
  userId: string,
  limit: number = DEFAULT_MAX_CONNECTORS_PER_USER,
): void {
  const current = countConnectors(db, userId);
  if (current >= limit) throw new ConnectorLimitError(current, limit);
}
