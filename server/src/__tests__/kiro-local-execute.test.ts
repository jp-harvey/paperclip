import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@paperclipai/adapter-kiro-local/server";

/**
 * Writes a fake kiro-cli command that mimics real Kiro CLI v2 output:
 * - stdout: `> <response>` (assistant response with > prefix)
 * - stderr: trust banner + credits line
 * - Captures args and env to a JSON file for assertions
 */
async function writeFakeKiroCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const argv = process.argv.slice(2);

// Only capture args for the actual chat invocation, not --list-sessions
const isListSessions = argv.includes("--list-sessions");

if (capturePath && !isListSessions) {
  const payload = {
    argv,
    env: {
      KIRO_API_KEY: process.env.KIRO_API_KEY || null,
      PAPERCLIP_AGENT_ID: process.env.PAPERCLIP_AGENT_ID || null,
      PAPERCLIP_COMPANY_ID: process.env.PAPERCLIP_COMPANY_ID || null,
      PAPERCLIP_RUN_ID: process.env.PAPERCLIP_RUN_ID || null,
      PAPERCLIP_API_KEY: process.env.PAPERCLIP_API_KEY || null,
      PAPERCLIP_TASK_ID: process.env.PAPERCLIP_TASK_ID || null,
      PAPERCLIP_WAKE_REASON: process.env.PAPERCLIP_WAKE_REASON || null,
      PAPERCLIP_WORKSPACE_CWD: process.env.PAPERCLIP_WORKSPACE_CWD || null,
    },
    paperclipEnvKeys: Object.keys(process.env)
      .filter((key) => key.startsWith("PAPERCLIP_"))
      .sort(),
  };
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}

if (isListSessions) {
  // Find the marker from the prompt in the capture file to return a matching session
  let marker = "";
  try {
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    const prompt = captured.argv[captured.argv.length - 1] || "";
    const m = prompt.match(/\\[pcsid:[^\\]]+\\]/);
    if (m) marker = m[0].slice(1, -1); // strip brackets
  } catch {}
  console.log("Chat sessions for /tmp/test:");
  console.log("");
  console.log("Chat SessionId: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  console.log("  0 seconds ago | " + (marker ? "[" + marker + "] " : "") + "prompt preview | 2 msgs | v1");
  process.exit(0);
} else {
  // Mimic real kiro-cli output format
  process.stderr.write("All tools are now trusted (!)\\n\\n");
  process.stderr.write(" ▸ Credits: 0.04 • Time: 1s\\n");
  console.log("> I've completed the task successfully.");
  process.exit(0);
}
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  env: Record<string, string | null>;
  paperclipEnvKeys: string[];
};

type LogEntry = {
  stream: "stdout" | "stderr";
  chunk: string;
};

describe("kiro execute", () => {
  it("passes --no-interactive and --trust-all-tools with the prompt as a positional arg", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-basic-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeKiroCommand(commandPath);

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-basic",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "You are agent {{agent.id}} ({{agent.name}}). Do the work.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(result.provider).toBe("kiro");
      // Summary should have the > prefix stripped
      expect(result.summary).toBe("I've completed the task successfully.");
      // Credits parsed from stderr
      expect(result.costUsd).toBe(0.04);
      // Session discovered from --list-sessions
      expect(result.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toContain("chat");
      expect(capture.argv).toContain("--no-interactive");
      expect(capture.argv).toContain("--trust-all-tools");
      // The prompt is the last positional arg
      const lastArg = capture.argv[capture.argv.length - 1]!;
      expect(lastArg).toContain("You are agent agent-1 (Kiro Agent)");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects PAPERCLIP env vars and passes authToken as PAPERCLIP_API_KEY", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-env-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeKiroCommand(commandPath);

    try {
      await execute({
        runId: "run-env",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Do the work.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "issue_assigned",
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.env.PAPERCLIP_AGENT_ID).toBe("agent-1");
      expect(capture.env.PAPERCLIP_COMPANY_ID).toBe("company-1");
      expect(capture.env.PAPERCLIP_RUN_ID).toBe("run-env");
      expect(capture.env.PAPERCLIP_API_KEY).toBe("run-jwt-token");
      expect(capture.env.PAPERCLIP_TASK_ID).toBe("issue-1");
      expect(capture.env.PAPERCLIP_WAKE_REASON).toBe("issue_assigned");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("passes --model when configured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-model-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeKiroCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-model",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "claude-sonnet-4-20250514",
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Do the work.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.model).toBe("claude-sonnet-4-20250514");

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      const modelIdx = capture.argv.indexOf("--model");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(capture.argv[modelIdx + 1]).toBe("claude-sonnet-4-20250514");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("passes --resume-id when a previous session is available", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-resume-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeKiroCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-resume",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: "prev-session-uuid",
          sessionParams: {
            sessionId: "prev-session-uuid",
            cwd: workspace,
          },
          sessionDisplayId: "prev-session-uuid",
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Continue the work.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      const resumeIdx = capture.argv.indexOf("--resume-id");
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(capture.argv[resumeIdx + 1]).toBe("prev-session-uuid");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports invocation metadata via onMeta", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-meta-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeKiroCommand(commandPath);

    let meta: { adapterType?: string; command?: string; cwd?: string; prompt?: string } = {};
    try {
      const result = await execute({
        runId: "run-meta",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Do the work.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (m) => {
          meta = m;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(meta.adapterType).toBe("kiro_local");
      expect(meta.command).toBe(commandPath);
      expect(meta.cwd).toBe(workspace);
      expect(meta.prompt).toContain("Do the work.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prepends instructions file content to the prompt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-execute-instructions-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kiro-cli");
    const capturePath = path.join(root, "capture.json");
    const instructionsPath = path.join(root, "AGENTS.md");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(instructionsPath, "You are a managed Kiro agent.\n", "utf8");
    await writeFakeKiroCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-instructions",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kiro Agent",
          adapterType: "kiro_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          instructionsFilePath: instructionsPath,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      const prompt = capture.argv[capture.argv.length - 1]!;
      expect(prompt).toContain("You are a managed Kiro agent.");
      expect(prompt).toContain("Follow the heartbeat.");
      // Instructions should come before the heartbeat prompt
      const instructionsIdx = prompt.indexOf("managed Kiro agent");
      const heartbeatIdx = prompt.indexOf("Follow the heartbeat");
      expect(instructionsIdx).toBeLessThan(heartbeatIdx);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
