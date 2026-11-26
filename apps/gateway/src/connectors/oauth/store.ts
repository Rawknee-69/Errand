import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { VaultError } from "../../vault/common.ts";
import type { CredentialStore } from "../../vault/credentials.ts";
import type { Vault } from "../../vault/vault.ts";

const OAUTH_CREDENTIAL_KIND = "oauth";
const OAUTH_ATTEMPT_KIND = "oauth_attempt";

export type ConnectorOAuthState = {
  clientInformation?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  discoveryState?: OAuthDiscoveryState;
  resourceUrl?: string;
};

export type AttemptSecret = {
  codeVerifier?: string;
};

const tokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  issuer: z.string().optional(),
});

const clientInformationSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(),
  client_id_issued_at: z.number().optional(),
  client_secret_expires_at: z.number().optional(),
  issuer: z.string().optional(),
});

function isDiscoveryState(value: unknown): value is OAuthDiscoveryState {
  if (value === null || typeof value !== "object") return false;
  const candidate: Record<string, unknown> = { ...value };
  return typeof candidate.authorizationServerUrl === "string";
}

const discoveryStateSchema = z.custom<OAuthDiscoveryState>(isDiscoveryState);

function parseObject(secret: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(secret);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return { ...parsed };
}

function parseConnectorOAuthState(secret: string | undefined): ConnectorOAuthState {
  if (secret === undefined) return {};
  const raw = parseObject(secret);
  const state: ConnectorOAuthState = {};
  const tokens = tokensSchema.safeParse(raw.tokens);
  if (tokens.success) state.tokens = tokens.data;
  const clientInformation = clientInformationSchema.safeParse(raw.clientInformation);
  if (clientInformation.success) state.clientInformation = clientInformation.data;
  const discoveryState = discoveryStateSchema.safeParse(raw.discoveryState);
  if (discoveryState.success) state.discoveryState = discoveryState.data;
  if (typeof raw.resourceUrl === "string") state.resourceUrl = raw.resourceUrl;
  return state;
}

function parseAttemptSecret(secret: string | undefined): AttemptSecret {
  if (secret === undefined) return {};
  const raw = parseObject(secret);
  return typeof raw.codeVerifier === "string" ? { codeVerifier: raw.codeVerifier } : {};
}

// The vault owns decryption; this class only names the two credential rows the
// OAuth flow needs and turns their JSON into typed state.
export class OAuthStore {
  constructor(
    private readonly vault: Vault,
    private readonly credentials: CredentialStore,
  ) {}

  attemptServiceId(attemptId: string): string {
    return `oauth_attempt:${attemptId}`;
  }

  attemptSecret(attemptId: string): Promise<AttemptSecret> {
    return this.read(this.attemptServiceId(attemptId), parseAttemptSecret);
  }

  saveAttemptSecret(attemptId: string, secret: AttemptSecret): void {
    this.credentials.store({
      serviceId: this.attemptServiceId(attemptId),
      kind: OAUTH_ATTEMPT_KIND,
      secret: JSON.stringify(secret),
    });
  }

  deleteAttemptSecret(attemptId: string): void {
    this.credentials.remove(this.attemptServiceId(attemptId));
  }

  connectorState(connectorId: string): Promise<ConnectorOAuthState> {
    return this.read(connectorId, parseConnectorOAuthState);
  }

  updateConnectorState(
    connectorId: string,
    transform: (current: ConnectorOAuthState) => ConnectorOAuthState,
  ): ConnectorOAuthState {
    let next: ConnectorOAuthState = {};
    this.credentials.mutateSecret({
      serviceId: connectorId,
      kind: OAUTH_CREDENTIAL_KIND,
      connectorId,
      transform: (current) => {
        next = transform(parseConnectorOAuthState(current));
        return JSON.stringify(next);
      },
    });
    return next;
  }

  private async read<T>(
    serviceId: string,
    parse: (secret: string | undefined) => T,
  ): Promise<T> {
    try {
      return await this.vault.withCredential(serviceId, parse);
    } catch (error) {
      if (error instanceof VaultError && error.code === "credential_not_found") return parse(undefined);
      throw error;
    }
  }
}
