import { describe, expect, it } from "vitest";
import { parseKiroStdoutLine } from "./parse-stdout.js";

describe("parseKiroStdoutLine", () => {
  it("returns a stdout entry for plain text lines", () => {
    const result = parseKiroStdoutLine(
      "I've reviewed the code and everything looks good.",
      "2026-04-19T12:00:00.000Z",
    );

    expect(result).toEqual([{
      kind: "stdout",
      ts: "2026-04-19T12:00:00.000Z",
      text: "I've reviewed the code and everything looks good.",
    }]);
  });

  it("returns empty array for blank lines", () => {
    expect(parseKiroStdoutLine("", "2026-04-19T12:00:00.000Z")).toEqual([]);
    expect(parseKiroStdoutLine("   ", "2026-04-19T12:00:00.000Z")).toEqual([]);
  });

  it("trims whitespace from output lines", () => {
    const result = parseKiroStdoutLine(
      "  hello world  ",
      "2026-04-19T12:00:00.000Z",
    );

    expect(result).toEqual([{
      kind: "stdout",
      ts: "2026-04-19T12:00:00.000Z",
      text: "hello world",
    }]);
  });
});
