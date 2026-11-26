import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { classifyAddress, stripBrackets, type BlockedReason } from "./address.ts";

export type EgressRefusalCode =
  | "invalid-url"
  | "invalid-request"
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
  return egressRequest(input, { method: "GET" }, options);
}

type RequestOnceOptions = {
  method: string;
  headers: Headers;
  body: Buffer | undefined;
  signal: AbortSignal | null | undefined;
};

export async function egressRequest(
  input: string | URL,
  init: RequestInit = {},
  options: EgressOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let url = parseUrl(input);
  let method = (init.method ?? "GET").toUpperCase();
  let headers = new Headers(init.headers);
  let body = await requestBody(init.body);

  for (let followed = 0; ; followed++) {
    const target = await validateTarget(url, options);

    let pending: { response: IncomingMessage; deadline: AbortSignal; cleanup: () => void };
    try {
      pending = await requestOnce(target, { method, headers, body, signal: init.signal }, timeoutMs);
    } catch (error) {
      if (error instanceof EgressRefusal) throw error;
      const reason = abortReason(init.signal);
      if (reason !== undefined) throw reason;
      throw error;
    }

    const { response, deadline } = pending;
    if (!redirectStatuses.has(response.statusCode ?? 0)) {
      return toResponse(response, target.url, maxResponseBytes, deadline, pending.cleanup);
    }

    const location = response.headers.location;
    response.on("error", () => undefined);
    response.destroy();
    pending.cleanup();
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

    const next = parseUrl(new URL(location, target.url));
    const status = response.statusCode ?? 0;
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
    }
    if (next.origin !== target.url.origin) stripOriginHeaders(headers);
    url = next;
  }
}

async function requestBody(body: RequestInit["body"]): Promise<Buffer | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new EgressRefusal("invalid-request", "Unsupported request body for an egress request");
}

function stripOriginHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (name === "authorization" || name === "cookie" || name.startsWith("x-")) {
      headers.delete(name);
    }
  }
}

function abortReason(signal: AbortSignal | null | undefined): EgressRefusal | undefined {
  if (!signal?.aborted) return undefined;
  return signal.reason instanceof EgressRefusal
    ? signal.reason
    : new EgressRefusal("timeout", "The request was aborted");
}

function requestOnce(
  target: Target,
  request: RequestOnceOptions,
  timeoutMs: number,
): Promise<{ response: IncomingMessage; deadline: AbortSignal; cleanup: () => void }> {
  const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort(request.signal?.reason);
  if (request.signal?.aborted === true) onCallerAbort();
  else request.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort(
      new EgressRefusal("timeout", `${target.url.href} did not answer within ${timeoutMs}ms`),
    );
  }, timeoutMs);

  const cleanup = (): void => {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onCallerAbort);
  };

  return new Promise((resolve, reject) => {
    const outgoing = transport(
      target.url,
      {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        agent: false,
        signal: controller.signal,
        lookup: pinnedLookup(target.address),
      },
      (response) => {
        clearTimeout(timer);
        resolve({ response, deadline: controller.signal, cleanup });
      },
    );
    outgoing.on("error", (error) => {
      cleanup();
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        reject(reason instanceof EgressRefusal ? reason : error);
        return;
      }
      reject(error);
    });
    if (request.body !== undefined) outgoing.write(request.body);
    outgoing.end();
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
  cleanup: () => void,
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
    cleanup();
    throw new EgressRefusal(
      "response-too-large",
      `${url.href} declares ${declared} bytes; the limit is ${maxBytes}`,
    );
  }

  const status = response.statusCode ?? 502;
  if (status === 204 || status === 205 || status === 304) {
    response.resume();
    cleanup();
    return new Response(null, { status, statusText: response.statusMessage ?? "", headers });
  }

  let seen = 0;
  let finished = false;
  const failWith = (error: unknown): unknown =>
    deadline.aborted && deadline.reason instanceof EgressRefusal ? deadline.reason : error;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (error: unknown): void => {
        if (finished) return;
        finished = true;
        cleanup();
        response.destroy();
        controller.error(failWith(error));
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
        cleanup();
        controller.close();
      });
      response.on("error", (error) => {
        fail(error);
      });
      response.on("aborted", () => {
        fail(new Error(`${url.href} closed the response early`));
      });
    },
    cancel() {
      finished = true;
      cleanup();
      response.destroy();
    },
  });

  return new Response(body, { status, statusText: response.statusMessage ?? "", headers });
}
