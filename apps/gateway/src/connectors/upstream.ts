import type { Db } from "../db/client.ts";
import type { VaultKeyring } from "../vault/keyring.ts";
import {
  callConnectorTool,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESULT_CAP_BYTES,
  type ConnectorCallTarget,
  type ConnectorToolResult,
} from "./call.ts";
import type { DiscoverOptions } from "./mcp.ts";
import { createConnectorServiceDeps } from "./service.ts";

export type UpstreamRead = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<ConnectorToolResult>;

export type UpstreamOptions = {
  db: Db;
  keyring: VaultKeyring;
  userId: string;
  discoverOptions: DiscoverOptions;
  redirectUri: string;
  timeoutMs?: number;
  resultCapBytes?: number;
};

export type Upstream = {
  // A caller with its own deadline passes what is left of it; the cap is the
  // module's.
  call(
    connector: ConnectorCallTarget,
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<ConnectorToolResult>;
  reader(connector: ConnectorCallTarget): UpstreamRead;
};

// The one module that reaches an upstream tool: it owns the vault credential,
// the result cap and the timeout, so no caller reassembles them.
export function createUpstream(options: UpstreamOptions): Upstream {
  const serviceDeps = createConnectorServiceDeps({
    db: options.db,
    keyring: options.keyring,
    userId: options.userId,
    discoverOptions: options.discoverOptions,
    redirectUri: options.redirectUri,
  });
  const callOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    resultCapBytes: options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES,
  };

  return {
    call(connector, tool, args, timeoutMs) {
      return callConnectorTool(serviceDeps, connector, tool, args, {
        ...callOptions,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
    reader(connector) {
      return (tool, args) => callConnectorTool(serviceDeps, connector, tool, args, callOptions);
    },
  };
}
