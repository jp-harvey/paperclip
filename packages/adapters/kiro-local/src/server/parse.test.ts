import { describe, expect, it } from "vitest";
import { parseKiroStdout, isKiroAuthRequired, isKiroUnknownSessionError } from "./parse.js";

describe("parseKiroStdout", () => {
  it("extracts a session id from output", () => {
    const stdout = [
      "session: a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "Hello! How can I help you today?",
    ].join("\n");

    const result = parseKiroStdout(stdout);
    expect(result.sessionId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result.summary).toContain("Hello");
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

  it("returns the last lines as summary when no session id is found", () => {
    const stdout = [
      "I've reviewed the code and made the changes.",
      "All tests pass.",
    ].join("\n");

    const result = parseKiroStdout(stdout);
    expect(result.sessionId).toBeNull();
    expect(result.summary).toContain("All tests pass.");
    expect(result.errorMessage).toBeNull();
  });

  it("handles empty output", () => {
    const result = parseKiroStdout("");
    expect(result.sessionId).toBeNull();
    expect(result.summary).toBe("");
    expect(result.errorMessage).toBeNull();
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

describe("isKiroUnknownSessionError", () => {
  it("detects unknown session errors", () => {
    expect(isKiroUnknownSessionError("unknown session", "")).toBe(true);
    expect(isKiroUnknownSessionError("", "session abc-123 not found")).toBe(true);
    expect(isKiroUnknownSessionError("", "conversation xyz not found")).toBe(true);
  });

  it("does not classify unrelated failures as session errors", () => {
    expect(isKiroUnknownSessionError("", "model overloaded")).toBe(false);
    expect(isKiroUnknownSessionError("timeout", "")).toBe(false);
  });
});
