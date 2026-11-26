import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_CONNECTORS_PER_USER } from "../src/connectors/quota.ts";
import { DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS } from "../src/egress/guard.ts";
import { loadConfig } from "../src/config.ts";

const keys = {
  VAULT_KEY: "v".repeat(32),
  HMAC_KEY: "h".repeat(32),
  JWT_SECRET: "j".repeat(32),
  OWNER_PASSPHRASE: "correct horse battery staple",
};

describe("loadConfig", () => {
  test("accepts three secrets of exactly 32 bytes", () => {
    expect(loadConfig({ ...keys })).toMatchObject({
      VAULT_KEY: keys.VAULT_KEY,
      HMAC_KEY: keys.HMAC_KEY,
      JWT_SECRET: keys.JWT_SECRET,
      PORT: 8787,
    });
  });

  test("counts secret length in bytes, not characters", () => {
    const sixteenTwoByteCharacters = "é".repeat(16);

    expect(Buffer.byteLength(sixteenTwoByteCharacters)).toBe(32);
    expect(() =>
      loadConfig({ ...keys, VAULT_KEY: sixteenTwoByteCharacters }),
    ).not.toThrow();
  });

  test("rejects a secret that is one byte short", () => {
    expect(() =>
      loadConfig({ ...keys, VAULT_KEY: "v".repeat(31) }),
    ).toThrow(/VAULT_KEY.*32 bytes/);
  });

  test("names every missing secret", () => {
    let message = "";
    try {
      loadConfig({});
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain("VAULT_KEY");
    expect(message).toContain("HMAC_KEY");
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain("OWNER_PASSPHRASE");
  });

  test("rejects a passphrase shorter than 12 characters", () => {
    expect(() => loadConfig({ ...keys, OWNER_PASSPHRASE: "short" })).toThrow(
      /OWNER_PASSPHRASE.*12 characters/,
    );
  });

  test("reads a custom port", () => {
    expect(loadConfig({ ...keys, PORT: "9999" }).PORT).toBe(9999);
  });

  test("defaults the dev egress flag off and limits the fetch surface", () => {
    expect(loadConfig({ ...keys })).toMatchObject({
      ALLOW_LOCALHOST_DEV: false,
      DEMO_MODE: false,
      SESSION_COOKIE_SECURE: true,
      SESSION_TTL_HOURS: 12,
      EGRESS_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
      EGRESS_MAX_RESPONSE_BYTES: DEFAULT_MAX_RESPONSE_BYTES,
      MAX_CONNECTORS_PER_USER: DEFAULT_MAX_CONNECTORS_PER_USER,
    });
  });

  test.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("parses ALLOW_LOCALHOST_DEV=%s as %s", (value, expected) => {
    expect(loadConfig({ ...keys, ALLOW_LOCALHOST_DEV: value }).ALLOW_LOCALHOST_DEV).toBe(expected);
  });

  test("rejects a non-boolean dev flag", () => {
    expect(() => loadConfig({ ...keys, ALLOW_LOCALHOST_DEV: "yes" })).toThrow(/ALLOW_LOCALHOST_DEV/);
  });

  test("rejects a zero egress timeout", () => {
    expect(() => loadConfig({ ...keys, EGRESS_TIMEOUT_MS: "0" })).toThrow(/EGRESS_TIMEOUT_MS/);
  });

  test("rejects a zero connector limit", () => {
    expect(() => loadConfig({ ...keys, MAX_CONNECTORS_PER_USER: "0" })).toThrow(
      /MAX_CONNECTORS_PER_USER/,
    );
  });

  test("accepts an absent or absolute WEB_ORIGIN", () => {
    expect(loadConfig({ ...keys }).WEB_ORIGIN).toBeUndefined();
    expect(loadConfig({ ...keys, WEB_ORIGIN: "https://app.example" }).WEB_ORIGIN).toBe(
      "https://app.example",
    );
    expect(loadConfig({ ...keys, WEB_ORIGIN: "https://app.example/" }).WEB_ORIGIN).toBe(
      "https://app.example",
    );
  });

  test.each([
    "app.example",
    "/connectors",
    "ftp://app.example",
    "javascript:alert(1)",
    "https://app.example/path",
    "https://user:secret@app.example",
    " https://app.example ",
  ])("rejects WEB_ORIGIN=%s", (value) => {
    expect(() => loadConfig({ ...keys, WEB_ORIGIN: value })).toThrow(/WEB_ORIGIN/);
  });

  test("accepts an http(s) redirect URI and rejects other shapes", () => {
    expect(
      loadConfig({ ...keys, OAUTH_REDIRECT_URI: "https://gw.example/api/oauth/callback" })
        .OAUTH_REDIRECT_URI,
    ).toBe("https://gw.example/api/oauth/callback");
    expect(() =>
      loadConfig({ ...keys, OAUTH_REDIRECT_URI: "ftp://gw.example/callback" }),
    ).toThrow(/OAUTH_REDIRECT_URI/);
    expect(() =>
      loadConfig({ ...keys, OAUTH_REDIRECT_URI: "/api/oauth/callback" }),
    ).toThrow(/OAUTH_REDIRECT_URI/);
  });
});
