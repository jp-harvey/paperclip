import { describe, expect, it } from "vitest";
import { buildKiroLocalConfig } from "./build-config.js";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "kiro_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: false,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 1000,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

describe("buildKiroLocalConfig", () => {
  it("sets trustAllTools to true by default", () => {
    const config = buildKiroLocalConfig(makeValues());
    expect(config.trustAllTools).toBe(true);
  });

  it("includes cwd and model when provided", () => {
    const config = buildKiroLocalConfig(
      makeValues({
        cwd: "/home/user/project",
        model: "claude-sonnet-4-20250514",
      }),
    );

    expect(config).toMatchObject({
      cwd: "/home/user/project",
      model: "claude-sonnet-4-20250514",
      trustAllTools: true,
    });
  });

  it("includes instructionsFilePath when provided", () => {
    const config = buildKiroLocalConfig(
      makeValues({
        instructionsFilePath: "/path/to/AGENTS.md",
      }),
    );

    expect(config.instructionsFilePath).toBe("/path/to/AGENTS.md");
  });

  it("includes env bindings from envVars", () => {
    const config = buildKiroLocalConfig(
      makeValues({
        envVars: "KIRO_API_KEY=test-key-123\nKIRO_LOG_LEVEL=debug",
      }),
    );

    expect(config.env).toEqual({
      KIRO_API_KEY: { type: "plain", value: "test-key-123" },
      KIRO_LOG_LEVEL: { type: "plain", value: "debug" },
    });
  });

  it("configures git_worktree workspace strategy", () => {
    const config = buildKiroLocalConfig(
      makeValues({
        workspaceStrategyType: "git_worktree",
        workspaceBaseRef: "main",
        workspaceBranchTemplate: "kiro/{{issue.key}}",
      }),
    );

    expect(config.workspaceStrategy).toEqual({
      type: "git_worktree",
      baseRef: "main",
      branchTemplate: "kiro/{{issue.key}}",
    });
  });
});
