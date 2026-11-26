import { ConnectorLimitError } from "../../src/connectors/quota.ts";
import { EgressRefusal } from "../../src/egress/guard.ts";

export async function egressRefusal(promise: Promise<unknown>): Promise<EgressRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EgressRefusal) return error;
    throw error;
  }
  throw new Error("expected an EgressRefusal");
}

export function connectorLimitRefusal(fn: () => void): ConnectorLimitError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConnectorLimitError) return error;
    throw error;
  }
  throw new Error("expected a ConnectorLimitError");
}
