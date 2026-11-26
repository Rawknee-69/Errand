import { describe, expect, test } from "bun:test";
import { errandTypeFor } from "../../src/policy/errand-type.ts";

describe("errand type", () => {
  test("is a deterministic hash of the sorted tool list and the constraint shape", () => {
    expect(errandTypeFor(["b__y", "a__x"], [])).toBe(
      "fd703fc0b0cc221751e8e2780ca73d0944462f73c2b809e328ea31b4cb4672dc",
    );
  });

  test("ignores tool order and duplicate constraint keys but keeps the shape", () => {
    expect(errandTypeFor(["a__x", "b__y"], [])).toBe(errandTypeFor(["b__y", "a__x"], []));
    expect(errandTypeFor(["a__x"], ["window", "max_cents", "window"])).toBe(
      "2fe05975f5217884ec710a0767dfdc072aef8cb0312896e7c1f82585b62fe929",
    );
  });

  test("a different tool set is a different kind of errand", () => {
    expect(errandTypeFor(["a__x"], [])).not.toBe(errandTypeFor(["a__x", "b__y"], []));
  });
});
