import { describe, expect, it } from "vitest";
import { parseKiroStdout, parseKiroCredits, isKiroAuthRequired } from "./parse.js";

describe("parseKiroStdout", () => {
  it("strips the > prefix from assistant response lines", () => {
    const stdout = "> Hello! How can I help you today?";
    const result = parseKiroStdout(stdout);
    expect(result.summary).toBe("Hello! How can I help you today?");
    expect(result.errorMessage).toBeNull();
  });

  it("captures error lines", () => {
    const stdout = [
      "error: authentication required",
      "Please run kiro-cli login",
    ].join("\n");

    const result = parseKiroStdout(stdout);
    expect(result.errorMessage).toBe("error: authentication required");
  });

  it("handles multi-line responses", () => {
    const stdout = [
      "> I've reviewed the code and made the changes.",
      "> All tests pass.",
    ].join("\n");

    const result = parseKiroStdout(stdout);
    expect(result.summary).toBe("I've reviewed the code and made the changes.\nAll tests pass.");
    expect(result.errorMessage).toBeNull();
  });

  it("handles empty output", () => {
    const result = parseKiroStdout("");
    expect(result.summary).toBe("");
    expect(result.errorMessage).toBeNull();
  });

  it("handles response without > prefix", () => {
    const stdout = "Hello";
    const result = parseKiroStdout(stdout);
    expect(result.summary).toBe("Hello");
  });
});

describe("isKiroAuthRequired", () => {
  it("detects login required messages", () => {
    expect(isKiroAuthRequired("", "not logged in")).toBe(true);
    expect(isKiroAuthRequired("please run kiro-cli login", "")).toBe(true);
    expect(isKiroAuthRequired("", "authentication required")).toBe(true);
    expect(isKiroAuthRequired("invalid api key", "")).toBe(true);
  });

  it("does not flag unrelated errors", () => {
    expect(isKiroAuthRequired("model overloaded", "")).toBe(false);
    expect(isKiroAuthRequired("", "timeout")).toBe(false);
  });
});

describe("parseKiroCredits", () => {
  it("extracts credits and time from the stderr summary line", () => {
    const stderr = [
      "All tools are now trusted (!). Kiro will execute tools without asking for confirmation.",
      "",
      " ▸ Credits: 0.04 • Time: 2s",
      "",
    ].join("\n");

    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(0.04);
    expect(result.timeSec).toBe(2);
  });

  it("handles larger credit values", () => {
    const stderr = " ▸ Credits: 12.50 • Time: 45s";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(12.5);
    expect(result.timeSec).toBe(45);
  });

  it("returns null when no credits line is present", () => {
    const stderr = "some random error output";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBeNull();
    expect(result.timeSec).toBeNull();
  });

  it("handles credits without time", () => {
    const stderr = " ▸ Credits: 0.07";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(0.07);
    expect(result.timeSec).toBeNull();
  });
});
