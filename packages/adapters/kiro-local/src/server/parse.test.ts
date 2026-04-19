import { describe, expect, it } from "vitest";
import { parseKiroStdout, parseKiroCredits, isKiroAuthRequired, generateSessionMarker, matchSessionByMarker } from "./parse.js";

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

describe("generateSessionMarker", () => {
  it("generates a short marker starting with pcsid:", () => {
    const marker = generateSessionMarker();
    expect(marker).toMatch(/^pcsid:[a-f0-9]{6}[a-z0-9]+$/);
    expect(marker.length).toBeLessThan(25);
  });

  it("generates unique markers", () => {
    const a = generateSessionMarker();
    const b = generateSessionMarker();
    expect(a).not.toBe(b);
  });
});

describe("matchSessionByMarker", () => {
  it("finds the session ID matching the marker in list-sessions output", () => {
    const output = `
Chat sessions for /Users/user/project:

Chat SessionId: 87117d77-e6b4-47a5-a483-2a90edee8b95
  0 seconds ago | [pcsid:abc123lz5] You are agent agent-1... | 2 msgs | v1

Chat SessionId: cd40197b-bdac-4bd0-adda-5cb2753648b5
  5 minutes ago | Some other prompt | 2 msgs | v1
`;
    const result = matchSessionByMarker(output, "pcsid:abc123lz5");
    expect(result).toBe("87117d77-e6b4-47a5-a483-2a90edee8b95");
  });

  it("returns null when no session matches the marker", () => {
    const output = `
Chat sessions for /Users/user/project:

Chat SessionId: 87117d77-e6b4-47a5-a483-2a90edee8b95
  0 seconds ago | Some unrelated prompt | 2 msgs | v1
`;
    const result = matchSessionByMarker(output, "pcsid:xyz789");
    expect(result).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(matchSessionByMarker("", "pcsid:abc123")).toBeNull();
  });
});
