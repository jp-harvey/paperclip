import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import path from "node:path";
import { checkKiroAuth } from "./parse.js";
import { buildKiroExecArgs } from "./kiro-args.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

import { firstNonEmptyLine } from "./utils.js";

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string): string | null {
  const raw = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "kiro-cli");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "kiro_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "kiro_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "kiro_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "kiro_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
      hint: "Install Kiro CLI: curl -fsSL https://cli.kiro.dev/install | bash",
    });
  }

  // Check for KIRO_API_KEY (optional — subscription auth also works)
  const configApiKey = env.KIRO_API_KEY;
  const hostApiKey = process.env.KIRO_API_KEY;
  if (isNonEmpty(configApiKey) || isNonEmpty(hostApiKey)) {
    const source = isNonEmpty(configApiKey) ? "adapter config env" : "server environment";
    checks.push({
      code: "kiro_api_key_present",
      level: "info",
      message: "KIRO_API_KEY is set for headless authentication.",
      detail: `Detected in ${source}.`,
    });
  } else {
    checks.push({
      code: "kiro_api_key_missing",
      level: "info",
      message: "KIRO_API_KEY is not set. Kiro CLI will use interactive login credentials if available.",
      hint: "For headless/CI usage, set KIRO_API_KEY in adapter env or server environment. For local usage, run `kiro-cli login`.",
    });
  }

  // Run auth and hello probes if the command is resolvable
  const canRunProbe =
    checks.every((check) => check.code !== "kiro_cwd_invalid" && check.code !== "kiro_command_unresolvable");
  if (canRunProbe) {
    if (!commandLooksLike(command, "kiro-cli")) {
      checks.push({
        code: "kiro_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `kiro-cli`.",
        detail: command,
      });
    } else {
      // Fast auth check via `kiro-cli whoami` — avoids the hang that occurs
      // when an unauthenticated Kiro CLI launches an interactive login prompt.
      const hasApiKey = isNonEmpty(configApiKey) || isNonEmpty(hostApiKey);
      if (!hasApiKey) {
        const authCheck = await checkKiroAuth(command, cwd, env, runChildProcess);
        if (authCheck.authenticated) {
          checks.push({
            code: "kiro_auth_verified",
            level: "info",
            message: "Kiro CLI is authenticated via interactive login.",
            detail: authCheck.detail,
          });
        } else {
          checks.push({
            code: "kiro_auth_missing",
            level: "warn",
            message: "Kiro CLI is not authenticated. Runs will fail until authentication is configured.",
            detail: authCheck.detail,
            hint: "Set KIRO_API_KEY in adapter env/shell or run `kiro-cli login`.",
          });
          // Skip the hello probe — it would hang on the login prompt.
          return {
            adapterType: ctx.adapterType,
            status: summarizeStatus(checks),
            checks,
            testedAt: new Date().toISOString(),
          };
        }
      }

      // Hello probe — only runs if auth is confirmed
      const execArgs = buildKiroExecArgs(config);
      const args = [...execArgs.args, "Respond with hello."];

      const probe = await runChildProcess(
        `kiro-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec: 60,
          graceSec: 5,
          onLog: async () => {},
        },
      );
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr);

      if (probe.timedOut) {
        checks.push({
          code: "kiro_hello_probe_timed_out",
          level: "warn",
          message: "Kiro CLI hello probe timed out.",
          hint: "Retry the probe. If this persists, verify Kiro CLI can run from this directory manually.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const hasHello = /\bhello\b/i.test(probe.stdout);
        checks.push({
          code: hasHello ? "kiro_hello_probe_passed" : "kiro_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "Kiro CLI hello probe succeeded."
            : "Kiro CLI probe ran but did not return `hello` as expected.",
          ...(detail ? { detail } : {}),
        });
      } else {
        checks.push({
          code: "kiro_hello_probe_failed",
          level: "error",
          message: "Kiro CLI hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: 'Run `kiro-cli chat --no-interactive --trust-all-tools "Respond with hello"` manually to debug.',
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
