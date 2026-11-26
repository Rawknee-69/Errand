import { describe, expect, test } from "bun:test";
import { assertFetchableUrl } from "../../src/egress/guard.ts";
import { egressRefusal as refusal } from "../support/refusals.ts";

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

const publicHost = { resolveHost: resolveTo("93.184.216.34") };

describe("assertFetchableUrl", () => {
  test("accepts an https URL whose host resolves to a public address", async () => {
    const url = await assertFetchableUrl("https://example.com/sse", publicHost);
    expect(url.href).toBe("https://example.com/sse");
  });

  test("refuses plain http for a public host", async () => {
    const error = await refusal(assertFetchableUrl("http://example.com/", publicHost));
    expect(error.code).toBe("scheme");
  });

  test("refuses a non-http scheme", async () => {
    const error = await refusal(assertFetchableUrl("file:///etc/passwd", publicHost));
    expect(error.code).toBe("scheme");
  });

  test.each([
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fd00:ec2::254]/",
  ])("refuses the literal address in %s without resolving", async (target) => {
    let resolved = false;
    const error = await refusal(
      assertFetchableUrl(target, {
        resolveHost: async () => {
          resolved = true;
          return ["93.184.216.34"];
        },
      }),
    );
    expect(error.code).toBe("blocked-address");
    expect(resolved).toBe(false);
  });

  test.each([
    "https://[::127.0.0.1]/",
    "https://[::10.0.0.1]/",
    "https://[fec0::1]/",
  ])("refuses the deprecated or compatible IPv6 form in %s", async (target) => {
    const error = await refusal(assertFetchableUrl(target, {}));
    expect(error.code).toBe("blocked-address");
  });

  test("refuses a hostname that resolves to a private address", async () => {
    const error = await refusal(
      assertFetchableUrl("https://internal.example.com/", {
        resolveHost: resolveTo("10.1.2.3"),
      }),
    );
    expect(error.code).toBe("blocked-address");
    expect(error.message).toContain("10.1.2.3");
  });

  test("refuses when any address a hostname resolves to is blocked", async () => {
    const error = await refusal(
      assertFetchableUrl("https://mixed.example.com/", {
        resolveHost: resolveTo("93.184.216.34", "169.254.169.254"),
      }),
    );
    expect(error.code).toBe("blocked-address");
  });

  test("refuses when the hostname does not resolve", async () => {
    const error = await refusal(
      assertFetchableUrl("https://missing.example.com/", {
        resolveHost: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
    );
    expect(error.code).toBe("dns");
  });

  test.each(["http://localhost:8787/sse", "http://127.0.0.1:8787/sse", "http://[::1]:8787/sse"])(
    "the dev flag allows plain http to %s",
    async (target) => {
      await expect(assertFetchableUrl(target, { allowLocalhostDev: true })).resolves.toBeInstanceOf(URL);
    },
  );

  test("the dev flag does not allow plain http to a public host", async () => {
    const error = await refusal(
      assertFetchableUrl("http://example.com/", { ...publicHost, allowLocalhostDev: true }),
    );
    expect(error.code).toBe("scheme");
  });

  test("the dev flag does not allow a metadata address", async () => {
    const error = await refusal(
      assertFetchableUrl("https://169.254.169.254/", { allowLocalhostDev: true }),
    );
    expect(error.code).toBe("blocked-address");
  });

  test("the dev flag does not allow a loopback name that resolves elsewhere", async () => {
    const error = await refusal(
      assertFetchableUrl("http://localhost:8787/", {
        allowLocalhostDev: true,
        resolveHost: resolveTo("10.0.0.7"),
      }),
    );
    expect(error.code).toBe("blocked-address");
  });

  test("the dev flag does not stretch to the rest of 127/8", async () => {
    const error = await refusal(
      assertFetchableUrl("https://127.0.0.2:8787/", { allowLocalhostDev: true }),
    );
    expect(error.code).toBe("blocked-address");
  });
});
