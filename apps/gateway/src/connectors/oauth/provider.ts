import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { ReauthRequiredError } from "./errors.ts";
import type { AttemptSecret, ConnectorOAuthState } from "./store.ts";

export type InvalidateScope = "all" | "client" | "tokens" | "verifier" | "discovery";

export type ConnectorOAuthProviderOptions = {
  redirectUri: string;
  state?: string;
  // A background refresh must never start a redirect; it raises needs_reauth.
  refreshOnly: boolean;
  readConnectorState: () => Promise<ConnectorOAuthState>;
  writeConnectorState: (
    transform: (current: ConnectorOAuthState) => ConnectorOAuthState,
  ) => ConnectorOAuthState;
  readAttemptSecret: () => Promise<AttemptSecret>;
  writeAttemptSecret: (secret: AttemptSecret) => void;
  onAuthorizationUrl: (url: URL) => void;
  onCredentialsInvalidated: (scope: InvalidateScope) => void;
};

// Discovery, registration and PKCE are the SDK's job; this provider only
// persists what the SDK hands it, each piece behind the vault.
export function createConnectorOAuthProvider(
  options: ConnectorOAuthProviderOptions,
): OAuthClientProvider {
  const clientMetadata: OAuthClientMetadata = {
    client_name: "Errand",
    redirect_uris: [options.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
  };

  const provider: OAuthClientProvider = {
    redirectUrl: options.redirectUri,
    clientMetadata,

    async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
      return (await options.readConnectorState()).clientInformation;
    },

    saveClientInformation(clientInformation: StoredOAuthClientInformation): void {
      options.writeConnectorState((current) => ({ ...current, clientInformation }));
    },

    async tokens(): Promise<StoredOAuthTokens | undefined> {
      return (await options.readConnectorState()).tokens;
    },

    saveTokens(tokens: StoredOAuthTokens): void {
      options.writeConnectorState((current) => ({ ...current, tokens }));
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      if (options.refreshOnly) {
        throw new ReauthRequiredError(
          "The authorization server requires a fresh sign-in before this connector can refresh",
        );
      }
      options.onAuthorizationUrl(authorizationUrl);
    },

    saveCodeVerifier(codeVerifier: string): void {
      options.writeAttemptSecret({ codeVerifier });
    },

    async codeVerifier(): Promise<string> {
      const secret = await options.readAttemptSecret();
      if (secret.codeVerifier === undefined) {
        throw new ReauthRequiredError("No PKCE verifier is stored for this authorization attempt");
      }
      return secret.codeVerifier;
    },

    invalidateCredentials(scope: InvalidateScope): void {
      options.writeConnectorState((current) => {
        const next = { ...current };
        if (scope === "tokens" || scope === "client" || scope === "all") delete next.tokens;
        if (scope === "client" || scope === "all") delete next.clientInformation;
        if (scope === "discovery" || scope === "all") delete next.discoveryState;
        return next;
      });
      options.onCredentialsInvalidated(scope);
    },

    async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
      return (await options.readConnectorState()).discoveryState;
    },

    saveDiscoveryState(state: OAuthDiscoveryState): void {
      options.writeConnectorState((current) => ({ ...current, discoveryState: state }));
    },

    async resourceUrl(): Promise<string | undefined> {
      return (await options.readConnectorState()).resourceUrl;
    },

    saveResourceUrl(resourceUrl: string): void {
      options.writeConnectorState((current) => ({ ...current, resourceUrl }));
    },
  };

  const startState = options.state;
  if (startState !== undefined) provider.state = () => startState;
  return provider;
}
