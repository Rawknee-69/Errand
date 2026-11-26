import { z } from "zod";

export function section(title: string): void {
  console.log("");
  console.log(`== ${title}`);
}

export function humanClient(base: string, cookie: string) {
  return async function human<T>(
    schema: z.ZodType<T>,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body)}`);
    return schema.parse(body);
  };
}
