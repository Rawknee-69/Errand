import { z } from "zod";

export type AuthInput =
  | { authType: "none" }
  | { authType: "bearer"; token: string }
  | { authType: "header"; headerName: string; headerValue: string }
  | { authType: "basic"; username: string; password: string };

export class HumanApi {
  private constructor(
    readonly base: string,
    private readonly cookie: string,
    readonly name: string,
  ) {}

  static async loginOwner(base: string, passphrase: string): Promise<HumanApi> {
    return HumanApi.login(base, { passphrase }, "owner");
  }

  static async loginFriend(base: string, name: string): Promise<HumanApi> {
    return HumanApi.login(base, { demoUser: name }, name);
  }

  private static async login(
    base: string,
    body: { passphrase: string } | { demoUser: string },
    name: string,
  ): Promise<HumanApi> {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${name} could not sign in: ${response.status} ${await response.text()}`);
    }
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined) throw new Error(`${name}'s sign-in did not set a cookie`);
    return new HumanApi(base, cookie, name);
  }

  async json<T>(
    schema: z.ZodType<T>,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", cookie: this.cookie },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`${this.name} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
    }
    return schema.parse(payload);
  }
}
