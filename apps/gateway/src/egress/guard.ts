import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { classifyAddress, stripBrackets, type BlockedReason } from "./address.ts";

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

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const devLoopbackNames = new Set(["localhost", "127.0.0.1", "::1"]);

const defaultResolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const reasonText: Record<BlockedReason, string> = {
  invalid: "not an IP address",
  loopback: "loopback addresses cannot be fetched",
  private: "private addresses cannot be fetched",
  "link-local": "link-local addresses cannot be fetched",
  cgnat: "carrier-grade NAT addresses cannot be fetched",
  unspecified: "unspecified addresses cannot be fetched",
  multicast: "multicast addresses cannot be fetched",
  reserved: "reserved addresses cannot be fetched",
  "cloud-metadata": "cloud metadata addresses cannot be fetched",
};

type Target = {
  url: URL;
  hostname: string;
  address: string;
};

export async function assertFetchableUrl(
  input: string | URL,
  options: EgressOptions = {},
): Promise<URL> {
  return (await validateTarget(input, options)).url;
}

async function validateTarget(input: string | URL, options: EgressOptions): Promise<Target> {
  const url = parseUrl(input);
  if (url.username !== "" || url.password !== "") {
    throw new EgressRefusal("invalid-url", "URLs must not embed credentials");
  }

  const hostname = stripBrackets(url.hostname);
  const devLoopback = options.allowLocalhostDev === true && devLoopbackNames.has(hostname);

  if (url.protocol !== "https:" && !(devLoopback && url.protocol === "http:")) {
    throw new EgressRefusal("scheme", `Only https is allowed, got ${url.protocol}//${hostname}`);
  }

  if (isIP(hostname) !== 0) {
    assertAllowedAddress(hostname, { devLoopback });
    return { url, hostname, address: hostname };
  }

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let addresses: string[];
  try {
    addresses = await resolveWithin(resolveHost(hostname), timeoutMs, hostname);
  } catch (error) {
    if (error instanceof EgressRefusal) throw error;
    throw new EgressRefusal("dns", `Could not resolve ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new EgressRefusal("dns", `Could not resolve ${hostname}`);
  }
  const first = addresses.at(0);
  if (first === undefined) {
    throw new EgressRefusal("dns", `Could not resolve ${hostname}`);
  }
  for (const address of addresses) {
    assertAllowedAddress(address, { devLoopback, hostname });
  }
  return { url, hostname, address: first };
}

async function resolveWithin<T>(pending: Promise<T>, timeoutMs: number, hostname: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EgressRefusal("timeout", `Could not resolve ${hostname} within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertAllowedAddress(
  address: string,
  { devLoopback, hostname }: { devLoopback: boolean; hostname?: string },
): void {
  const verdict = classifyAddress(address);
  if (verdict.allowed) return;
  if (devLoopback && verdict.reason === "loopback") return;
  const target = hostname === undefined ? address : `${hostname} resolves to ${address}`;
  throw new EgressRefusal("blocked-address", `${target}: ${reasonText[verdict.reason]}`);
}

function parseUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new EgressRefusal("invalid-url", `Not a valid URL: ${String(input)}`);
  }
}

export async function egressFetch(
  input: string | URL,
  options: EgressOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const deadline = AbortSignal.timeout(timeoutMs);

  let url = parseUrl(input);
  for (let followed = 0; ; followed++) {
    const target = await validateTarget(url, options);

    let response: IncomingMessage;
    try {
      response = await requestOnce(target, deadline);
    } catch (error) {
      if (deadline.aborted) {
        throw new EgressRefusal("timeout", `${target.url.href} did not answer within ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!redirectStatuses.has(response.statusCode ?? 0)) {
      return toResponse(response, target.url, maxResponseBytes, deadline);
    }

    const location = response.headers.location;
    response.on("error", () => undefined);
    response.destroy();
    if (location === undefined || location === "") {
      throw new EgressRefusal(
        "redirect-without-location",
        `${target.url.href} redirected without a location`,
      );
    }
    if (followed >= MAX_REDIRECTS) {
      throw new EgressRefusal(
        "redirect-limit",
        `${target.url.href} exceeded ${MAX_REDIRECTS} redirects`,
      );
    }
    url = parseUrl(new URL(location, target.url));
  }
}

function requestOnce(target: Target, deadline: AbortSignal): Promise<IncomingMessage> {
  const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(
      target.url,
      {
        method: "GET",
        agent: false,
        signal: deadline,
        lookup: pinnedLookup(target.address),
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
}

// The connection goes to the address that was validated, not to whatever the
// resolver answers a second time, which closes the DNS-rebinding gap.
function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function toResponse(
  response: IncomingMessage,
  url: URL,
  maxBytes: number,
  deadline: AbortSignal,
): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }

  const declared = Number(headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new EgressRefusal(
      "response-too-large",
      `${url.href} declares ${declared} bytes; the limit is ${maxBytes}`,
    );
  }

  const status = response.statusCode ?? 502;
  if (status === 204 || status === 205 || status === 304) {
    response.resume();
    return new Response(null, { status, statusText: response.statusMessage ?? "", headers });
  }

  let seen = 0;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (error: unknown): void => {
        if (finished) return;
        finished = true;
        response.destroy();
        controller.error(error);
      };
      response.on("data", (chunk: Buffer) => {
        if (finished) return;
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          fail(
            new EgressRefusal(
              "response-too-large",
              `${url.href} exceeded the ${maxBytes} byte limit`,
            ),
          );
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      });
      response.on("end", () => {
        if (finished) return;
        finished = true;
        controller.close();
      });
      response.on("error", (error) => {
        fail(
          deadline.aborted
            ? new EgressRefusal("timeout", `${url.href} timed out`)
            : error,
        );
      });
      response.on("aborted", () => {
        fail(
          deadline.aborted
            ? new EgressRefusal("timeout", `${url.href} timed out`)
            : new Error(`${url.href} closed the response early`),
        );
      });
    },
    cancel() {
      finished = true;
      response.destroy();
    },
  });

  return new Response(body, { status, statusText: response.statusMessage ?? "", headers });
}
