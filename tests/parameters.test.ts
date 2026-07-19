import { describe, expect, test } from "vitest";
import { parseParameters } from "../src/parameters.js";

describe("parseParameters", () => {
  test("parses repeated name=value entries", () => {
    expect(parseParameters(["limit=10", "query=hello world"])).toEqual({
      limit: "10",
      query: "hello world",
    });
  });
  test("rejects malformed entries", () => {
    expect(() => parseParameters(["missing"])).toThrow(/name=value/);
  });
});
