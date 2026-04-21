import path from "node:path";
import fs from "node:fs/promises";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  parseObject,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  resolveCommandForLogs,
  renderTemplate,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
  joinPromptSections,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { parseKiroStdout, parseKiroCredits, discoverSessionId, generateSessionMarker, checkKiroAuth } from "./parse.js";
import { buildKiroExecArgs } from "./kiro-args.js";
import { ensureKiroSkillsInjected } from "./skills.js";

import { firstNonEmptyLine } from "./utils.js";

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function resolveKiroBillingType(env: Record<string, string>): "api" | "credits" {
  // Kiro uses a credits-based billing model regardless of auth method.
  // With KIRO_API_KEY → "api" (metered API usage).
  // With interactive login → "credits" (subscription credits consumed per run).
  // Important: "subscription" maps to "subscription_included" in the ledger,
  // which zeroes out costUsd — wrong for Kiro where credits have real cost.
  return hasNonEmptyEnvValue(env, "KIRO_API_KEY") ? "api" : "credits";
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const command = asString(config.command, "kiro-cli");

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const workspaceBranch = asString(workspaceContext.branchName, "");
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "");
  const agentHome = asString(workspaceContext.agentHome, "");

  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  const envConfig = parseObject(config.env);

  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const hasExplicitApiKey =
    typeof envConfig.KIRO_API_KEY === "string" && envConfig.KIRO_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
  if (effectiveWorkspaceCwd) env.PAPERCLIP_WORKSPACE_CWD = effectiveWorkspaceCwd;
  if (workspaceSource) env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;
  if (workspaceStrategy) env.PAPERCLIP_WORKSPACE_STRATEGY = workspaceStrategy;
  if (workspaceId) env.PAPERCLIP_WORKSPACE_ID = workspaceId;
  if (workspaceRepoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceRepoUrl;
  if (workspaceRepoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceRepoRef;
  if (workspaceBranch) env.PAPERCLIP_WORKSPACE_BRANCH = workspaceBranch;
  if (workspaceWorktreePath) env.PAPERCLIP_WORKSPACE_WORKTREE_PATH = workspaceWorktreePath;
  if (agentHome) env.AGENT_HOME = agentHome;

  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const effectiveEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const billingType = resolveKiroBillingType(effectiveEnv);
  const runtimeEnv = ensurePathInEnv(effectiveEnv);
  await ensureCommandResolvable(command, cwd, runtimeEnv);
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  // Default to no timeout, consistent with other adapters. The auth hang
  // risk is mitigated by the `kiro-cli whoami` pre-flight check below.
  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);

  // Pre-flight auth check: run `kiro-cli whoami` to verify authentication
  // before launching the chat command. Without this, an unauthenticated
  // Kiro CLI will launch an interactive login prompt that hangs indefinitely
  // in headless mode (--no-interactive is ignored for the login flow).
  if (!hasNonEmptyEnvValue(effectiveEnv, "KIRO_API_KEY")) {
    const authCheck = await checkKiroAuth(command, cwd, env, runChildProcess);
    if (!authCheck.authenticated) {
      await onLog(
        "stdout",
        `[paperclip] Kiro CLI is not authenticated: ${authCheck.detail ?? "Not logged in"}. Run \`kiro-cli login\` or set KIRO_API_KEY.\n`,
      );
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: "Kiro CLI is not authenticated. Run `kiro-cli login` or set KIRO_API_KEY in adapter env.",
        errorCode: "auth_required",
      };
    }
  }

  // Inject Paperclip-managed skills into .kiro/skills/ before execution
  await ensureKiroSkillsInjected(cwd, parseObject(config), onLog);

  // Kiro CLI does not expose session IDs in stdout/stderr — they are stored
  // internally and only visible via `kiro-cli chat --list-sessions`. We still
  // pass --resume-id when a previous session is available so Kiro can resume
  // context, but we cannot extract a new session ID from the output.
  // Invalid resume IDs are silently ignored (Kiro starts a fresh session).
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const sessionId = canResumeSession ? runtimeSessionId : null;

  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stdout",
      `[paperclip] Kiro session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }

  // Build prompt
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stdout",
        `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: Boolean(sessionId) });
  const shouldUseResumeDeltaPrompt = Boolean(sessionId) && wakePrompt.length > 0;
  const promptInstructionsPrefix = shouldUseResumeDeltaPrompt ? "" : instructionsPrefix;
  const instructionsChars = promptInstructionsPrefix.length;
  const renderedPrompt = shouldUseResumeDeltaPrompt ? "" : renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const prompt = joinPromptSections([
    promptInstructionsPrefix,
    wakePrompt,
    sessionHandoffNote,
    renderedPrompt,
  ]);

  // For fresh sessions (no resume), prepend a short marker so we can
  // discover the session ID from `--list-sessions` after the run.
  // The marker is ~20 chars — negligible in the context window.
  const sessionMarker = sessionId ? null : generateSessionMarker();
  const finalPrompt = sessionMarker ? `[${sessionMarker}] ${prompt}` : prompt;
  const promptMetrics = {
    promptChars: finalPrompt.length,
    instructionsChars,
    wakePromptChars: wakePrompt.length,
    sessionHandoffChars: sessionHandoffNote.length,
    heartbeatPromptChars: renderedPrompt.length,
  };

  const execArgs = buildKiroExecArgs(config, { resumeSessionId: sessionId });
  const args = [...execArgs.args, finalPrompt];

  if (onMeta) {
    await onMeta({
      adapterType: "kiro_local",
      command: resolvedCommand,
      cwd,
      commandArgs: args.map((value, idx) => {
        if (idx === args.length - 1) return `<prompt ${finalPrompt.length} chars>`;
        return value;
      }),
      env: loggedEnv,
      prompt: finalPrompt,
      promptMetrics,
      context,
    });
  }

  // Strip ANSI escape codes from log chunks — Kiro CLI emits colors and
  // cursor controls even in --no-interactive mode.
  const ANSI_LOG_RE = /\x1b\[[?]?[0-9;]*[A-Za-z]|\x1b\].*?\x07/g;
  const cleanLog: typeof onLog = async (stream, chunk) => {
    const cleaned = chunk.replace(ANSI_LOG_RE, "");
    if (cleaned.trim()) {
      await onLog(stream, cleaned);
    }
  };

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onSpawn,
    onLog: cleanLog,
  });

  const parsed = parseKiroStdout(proc.stdout);
  const credits = parseKiroCredits(proc.stderr);

  // Convert Kiro credits to USD. Default rate is $0.04 per credit.
  // Configurable via adapter config `creditRateUsd` for different plans.
  const creditRateUsd = asNumber(config.creditRateUsd, 0.04);
  const costUsd = credits.credits !== null ? credits.credits * creditRateUsd : null;

  // Discover the session ID for fresh sessions by matching our marker
  // in the --list-sessions output. Skip for resumed sessions (we already
  // have the ID) and failed/timed-out runs.
  let discoveredSessionId: string | null = null;
  if (
    sessionMarker &&
    !proc.timedOut &&
    (proc.exitCode ?? 0) === 0
  ) {
    discoveredSessionId = await discoverSessionId(
      command,
      cwd,
      env,
      sessionMarker,
      runChildProcess,
    );
    if (discoveredSessionId) {
      await onLog(
        "stdout",
        `[paperclip] Discovered Kiro session "${discoveredSessionId}" for next resume.\n`,
      );
    }
  }

  const resolvedSessionId = discoveredSessionId ?? (runtimeSessionId || null);

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  const stderrLine = firstNonEmptyLine(proc.stderr);
  const fallbackErrorMessage =
    parsed.errorMessage ||
    stderrLine ||
    `Kiro CLI exited with code ${proc.exitCode ?? -1}`;

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    errorMessage: (proc.exitCode ?? 0) === 0 ? null : fallbackErrorMessage,
    // Session tracking: use discovered ID from fresh runs, or pass through
    // the existing runtime session for resumed runs.
    sessionId: resolvedSessionId,
    sessionParams: resolvedSessionId
      ? { sessionId: resolvedSessionId, cwd } as Record<string, unknown>
      : null,
    sessionDisplayId: resolvedSessionId,
    provider: "kiro",
    biller: "kiro",
    model: asString(config.model, ""),
    billingType,
    costUsd,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
      ...(credits.credits !== null ? { credits: credits.credits } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
      ...(credits.timeSec !== null ? { timeSec: credits.timeSec } : {}),
    },
    summary: parsed.summary,
  };
}
