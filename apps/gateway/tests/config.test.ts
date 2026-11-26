import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const keys = {
  VAULT_KEY: "v".repeat(32),
  HMAC_KEY: "h".repeat(32),
  JWT_SECRET: "j".repeat(32),
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
  });

  test("reads a custom port", () => {
    expect(loadConfig({ ...keys, PORT: "9999" }).PORT).toBe(9999);
  });
});
