import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyAddress, type BlockedReason } from "./address.ts";

export type EgressRefusalCode =
  | "invalid-url"
  | "scheme"
  | "dns"
  | "blocked-address"
  | "redirect-limit"
  | "redirect-without-location"
  | "timeout"
  | "response-too-large";

export class EgressRefusal extends Error {
  readonly code: EgressRefusalCode;

  constructor(code: EgressRefusalCode, message: string) {
    super(message);
    this.name = "EgressRefusal";
    this.code = code;
  }
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

export type EgressOptions = {
  allowLocalhostDev?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  resolveHost?: ResolveHost;
};

const defaultResolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const devLoopbackNames = new Set(["localhost", "127.0.0.1", "::1"]);

function hostnameOf(url: URL): string {
  const { hostname } = url;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export async function assertFetchableUrl(
  input: string | URL,
  options: EgressOptions = {},
): Promise<URL> {
  const url = parseUrl(input);
  if (url.username !== "" || url.password !== "") {
    throw new EgressRefusal("invalid-url", "URLs must not embed credentials");
  }

  const hostname = hostnameOf(url);
  const devLoopback = options.allowLocalhostDev === true && devLoopbackNames.has(hostname);

  if (url.protocol !== "https:" && !(devLoopback && url.protocol === "http:")) {
    throw new EgressRefusal("scheme", `Only https is allowed, got ${url.protocol}//${hostname}`);
  }

  if (isIP(hostname) !== 0) {
    assertAllowedAddress(hostname, { devLoopback });
    return url;
  }

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    throw new EgressRefusal("dns", `Could not resolve ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new EgressRefusal("dns", `Could not resolve ${hostname}`);
  }
  for (const address of addresses) {
    assertAllowedAddress(address, { devLoopback, hostname });
  }
  return url;
}

function assertAllowedAddress(
  address: string,
  { devLoopback, hostname }: { devLoopback: boolean; hostname?: string },
): void {
  const verdict = classifyAddress(address);
  if (verdict.allowed) return;
  if (devLoopback && verdict.reason === "loopback") return;
  const target = hostname === undefined ? address : `${hostname} resolves to ${address}`;
  throw new EgressRefusal("blocked-address", `${target}: ${describeReason(verdict.reason)}`);
}

function describeReason(reason: BlockedReason): string {
  switch (reason) {
    case "invalid":
      return "not an IP address";
    case "cloud-metadata":
      return "cloud metadata addresses cannot be fetched";
    case "link-local":
      return "link-local addresses cannot be fetched";
    case "cgnat":
      return "carrier-grade NAT addresses cannot be fetched";
    case "unspecified":
      return "unspecified addresses cannot be fetched";
    default:
      return `${reason} addresses cannot be fetched`;
  }
}

function parseUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new EgressRefusal("invalid-url", `Not a valid URL: ${String(input)}`);
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function egressFetch(
  input: string | URL,
  options: EgressOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const deadline = AbortSignal.timeout(timeoutMs);

  let url = parseUrl(input);
  for (let followed = 0; ; followed++) {
    url = await assertFetchableUrl(url, options);

    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal: deadline });
    } catch (error) {
      if (deadline.aborted) {
        throw new EgressRefusal("timeout", `${url.href} did not answer within ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!redirectStatuses.has(response.status)) {
      return capResponse(response, maxResponseBytes, deadline);
    }

    const location = response.headers.get("location");
    if (location === null || location === "") {
      throw new EgressRefusal("redirect-without-location", `${url.href} redirected without a location`);
    }
    if (followed >= MAX_REDIRECTS) {
      throw new EgressRefusal("redirect-limit", `${url.href} exceeded ${MAX_REDIRECTS} redirects`);
    }
    url = parseUrl(new URL(location, url));
  }
}

function capResponse(response: Response, maxBytes: number, deadline: AbortSignal): Response {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    void response.body?.cancel();
    throw new EgressRefusal(
      "response-too-large",
      `Response declares ${declared} bytes; the limit is ${maxBytes}`,
    );
  }
  if (response.body === null) return response;

  const reader = response.body.getReader();
  let seen = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (deadline.aborted) {
          controller.error(new EgressRefusal("timeout", "Response body timed out"));
          return;
        }
        controller.error(error);
        return;
      }
      if (chunk.done) {
        controller.close();
        return;
      }
      seen += chunk.value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel();
        controller.error(
          new EgressRefusal("response-too-large", `Response exceeded the ${maxBytes} byte limit`),
        );
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

