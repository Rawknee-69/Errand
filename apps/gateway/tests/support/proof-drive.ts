import assert from "node:assert/strict";
import { z } from "zod";

export function step(name: string): void {
  console.log(`\n== ${name}`);
}

export async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok, `${response.url} returned ${response.status}: ${text}`);
  return schema.parse(JSON.parse(text));
}

export function humanRequests(
  base: string,
  sessionCookie: string,
): (path: string, init?: RequestInit) => Promise<Response> {
  return (path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie: sessionCookie, ...(init.headers ?? {}) },
    });
}
