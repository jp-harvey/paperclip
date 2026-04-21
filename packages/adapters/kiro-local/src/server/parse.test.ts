import { describe, expect, it } from "vitest";
import { parseKiroStdout, parseKiroCredits, generateSessionMarker, matchSessionByMarker, discoverSessionId } from "./parse.js";

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

  it("handles minutes and seconds format", () => {
    const stderr = " ▸ Credits: 11.70 • Time: 4m 10s";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(11.7);
    expect(result.timeSec).toBe(250);
  });

  it("handles hours, minutes and seconds format", () => {
    const stderr = " ▸ Credits: 85.00 • Time: 1h 23m 45s";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(85);
    expect(result.timeSec).toBe(5025);
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

  it("strips ANSI codes before parsing", () => {
    const stderr = "\x1b[38;5;8m  ▸ Credits: 11.70 • Time: 4m 10s  \x1b[0m";
    const result = parseKiroCredits(stderr);
    expect(result.credits).toBe(11.7);
    expect(result.timeSec).toBe(250);
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

  it("strips ANSI escape codes before matching", () => {
    const output = [
      "\x1b[38;5;8mChat sessions for /Users/user/project:\x1b[0m",
      "",
      "\x1b[1mChat SessionId: 87117d77-e6b4-47a5-a483-2a90edee8b95\x1b[0m",
      "  0 seconds ago | \x1b[38;5;141m[pcsid:abc123lz5]\x1b[0m You are agent... | 2 msgs | v1",
    ].join("\n");
    const result = matchSessionByMarker(output, "pcsid:abc123lz5");
    expect(result).toBe("87117d77-e6b4-47a5-a483-2a90edee8b95");
  });

  it("checks multiple lines after the session ID line", () => {
    const output = [
      "Chat SessionId: 87117d77-e6b4-47a5-a483-2a90edee8b95",
      "  some metadata line",
      "  0 seconds ago | [pcsid:abc123lz5] prompt | 2 msgs | v1",
    ].join("\n");
    const result = matchSessionByMarker(output, "pcsid:abc123lz5");
    expect(result).toBe("87117d77-e6b4-47a5-a483-2a90edee8b95");
  });
});

describe("discoverSessionId", () => {
  it("returns null when the command fails", async () => {
    const mockRun = async () => ({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "error",
    });
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:abc123", mockRun as any);
    expect(result).toBeNull();
  });

  it("returns null when the marker is not found in output", async () => {
    const mockRun = async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "Chat SessionId: aaaa-bbbb\n  0 seconds ago | unrelated prompt | 2 msgs | v1",
      stderr: "",
    });
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:xyz789", mockRun as any);
    expect(result).toBeNull();
  });

  it("returns null when the command throws", async () => {
    const mockRun = async () => { throw new Error("spawn failed"); };
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:abc123", mockRun as any);
    expect(result).toBeNull();
  });

  it("returns the session ID when the marker matches", async () => {
    const mockRun = async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "Chat SessionId: 12345678-1234-1234-1234-123456789abc\n  0 seconds ago | [pcsid:abc123] prompt | 2 msgs | v1",
      stderr: "",
    });
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:abc123", mockRun as any);
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("finds the session from stderr (where --list-sessions outputs)", async () => {
    const mockRun = async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Chat SessionId: 12345678-1234-1234-1234-123456789abc\n  0 seconds ago | [pcsid:abc123] prompt | 2 msgs | v1",
    });
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:abc123", mockRun as any);
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("finds the session from ANSI-wrapped stderr output", async () => {
    const mockRun = async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "\x1b[1mChat SessionId: 12345678-1234-1234-1234-123456789abc\x1b[0m\n  0 seconds ago | \x1b[38;5;141m[pcsid:abc123]\x1b[0m prompt | 2 msgs | v1",
    });
    const result = await discoverSessionId("kiro-cli", "/tmp", {}, "pcsid:abc123", mockRun as any);
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
  });
});
