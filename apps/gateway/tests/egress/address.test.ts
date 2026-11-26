import { describe, expect, test } from "bun:test";
import { classifyAddress, type BlockedReason } from "../../src/egress/address.ts";

const blocked: [string, BlockedReason][] = [
  ["127.0.0.1", "loopback"],
  ["127.10.20.30", "loopback"],
  ["::1", "loopback"],
  ["0.0.0.0", "unspecified"],
  ["::", "unspecified"],
  ["10.1.2.3", "private"],
  ["172.16.0.1", "private"],
  ["172.31.255.255", "private"],
  ["192.168.1.1", "private"],
  ["fc00::1", "private"],
  ["fd12:3456::1", "private"],
  ["169.254.1.1", "link-local"],
  ["fe80::1", "link-local"],
  ["fe80::1%eth0", "link-local"],
  ["100.64.0.1", "cgnat"],
  ["100.127.255.254", "cgnat"],
  ["169.254.169.254", "cloud-metadata"],
  ["169.254.170.2", "cloud-metadata"],
  ["100.100.100.200", "cloud-metadata"],
  ["fd00:ec2::254", "cloud-metadata"],
  ["224.0.0.1", "multicast"],
  ["239.255.255.250", "multicast"],
  ["ff02::1", "multicast"],
  ["240.0.0.1", "reserved"],
  ["255.255.255.255", "reserved"],
  ["192.0.2.10", "reserved"],
  ["2001:db8::1", "reserved"],
  ["::ffff:127.0.0.1", "loopback"],
  ["::ffff:169.254.169.254", "cloud-metadata"],
  ["::ffff:10.0.0.1", "private"],
  ["64:ff9b::a00:1", "private"],
];

const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"];

describe("classifyAddress", () => {
  test.each(blocked)("blocks %s as %s", (address, reason) => {
    expect(classifyAddress(address)).toEqual({ allowed: false, reason });
  });

  test.each(allowed)("allows public address %s", (address) => {
    expect(classifyAddress(address)).toEqual({ allowed: true });
  });

  test("treats bracket notation as the address inside", () => {
    expect(classifyAddress("[::1]")).toEqual({ allowed: false, reason: "loopback" });
  });

  test("rejects a value that is not an IP address", () => {
    expect(classifyAddress("example.com")).toEqual({ allowed: false, reason: "invalid" });
  });
});
