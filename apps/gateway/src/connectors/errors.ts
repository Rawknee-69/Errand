export type ConnectorErrorCode =
  | "not_found"
  | "credential"
  | "oauth_state"
  | "oauth_issuer"
  | "oauth_failed"
  | "reauth"
  | "confirmation_required"
  | "blocked";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
