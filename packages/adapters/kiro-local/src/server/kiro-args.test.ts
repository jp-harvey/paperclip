import { describe, expect, it } from "vitest";
import { buildKiroExecArgs } from "./kiro-args.js";

describe("buildKiroExecArgs", () => {
  it("builds default args with --no-interactive and --trust-all-tools", () => {
    const result = buildKiroExecArgs({});

    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
      "--trust-all-tools",
    ]);
    expect(result.model).toBe("");
  });

  it("includes --model when configured", () => {
    const result = buildKiroExecArgs({ model: "claude-sonnet-4-20250514" });

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
      "--model",
      "claude-sonnet-4-20250514",
      "--trust-all-tools",
    ]);
  });

  it("uses --trust-tools instead of --trust-all-tools when trustTools is set", () => {
    const result = buildKiroExecArgs({
      trustTools: "fs_read,fs_write,grep",
      trustAllTools: true,
    });

    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
      "--trust-tools=fs_read,fs_write,grep",
    ]);
  });

  it("omits trust flags when trustAllTools is false and trustTools is empty", () => {
    const result = buildKiroExecArgs({ trustAllTools: false });

    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
    ]);
  });

  it("appends --resume-id when resuming a session", () => {
    const result = buildKiroExecArgs({}, { resumeSessionId: "abc-123" });

    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
      "--trust-all-tools",
      "--resume-id",
      "abc-123",
    ]);
  });

  it("appends extra args from config", () => {
    const result = buildKiroExecArgs({
      extraArgs: ["--verbose", "--require-mcp-startup"],
    });

    expect(result.args).toEqual([
      "chat",
      "--no-interactive",
      "--trust-all-tools",
      "--verbose",
      "--require-mcp-startup",
    ]);
  });
});
