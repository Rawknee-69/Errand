import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { connectors } from "../db/schema.ts";
import { GatewayError } from "../errors.ts";

export const DEFAULT_MAX_CONNECTORS_PER_USER = 10;

export class ConnectorLimitError extends GatewayError {
  readonly count: number;
  readonly limit: number;

  constructor(count: number, limit: number) {
    super("connector_limit", `Connector limit reached: ${count} of ${limit} connectors in use`, 409);
    this.count = count;
    this.limit = limit;
  }
}

export function assertConnectorQuota(
  db: Db,
  userId: string,
  limit: number = DEFAULT_MAX_CONNECTORS_PER_USER,
): void {
  const row = db
    .select({ value: count() })
    .from(connectors)
    .where(eq(connectors.userId, userId))
    .all()[0];
  const current = row?.value ?? 0;
  if (current >= limit) throw new ConnectorLimitError(current, limit);
}
