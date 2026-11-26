import type { ContentfulStatusCode } from "hono/utils/http-status";

export type HttpStatus = ContentfulStatusCode;

// A client-facing failure carries its own HTTP status, so the route layer does
// not keep a second table of what each module's codes mean.
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
