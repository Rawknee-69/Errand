import { GatewayError, type HttpStatus } from "../errors.ts";

export type ConnectorErrorCode =
  | "not_found"
  | "credential"
  | "oauth_state"
  | "oauth_issuer"
  | "oauth_failed"
  | "reauth"
  | "confirmation_required"
  | "blocked";

const STATUS: Record<ConnectorErrorCode, HttpStatus> = {
  not_found: 404,
  credential: 400,
  oauth_state: 400,
  oauth_issuer: 400,
  oauth_failed: 502,
  reauth: 409,
  confirmation_required: 409,
  blocked: 409,
};

export class ConnectorError extends GatewayError {
  constructor(
    override readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(code, message, STATUS[code]);
  }
}
