import { asBoolean, asString, asStringArray } from "@paperclipai/adapter-utils/server-utils";

export interface BuildKiroExecArgsResult {
  args: string[];
  model: string;
}

function readExtraArgs(config: unknown): string[] {
  const fromExtraArgs = asStringArray(asRecord(config).extraArgs);
  if (fromExtraArgs.length > 0) return fromExtraArgs;
  return asStringArray(asRecord(config).args);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildKiroExecArgs(
  config: unknown,
  options: { resumeSessionId?: string | null } = {},
): BuildKiroExecArgsResult {
  const record = asRecord(config);
  const model = asString(record.model, "").trim();
  const trustAllTools = asBoolean(record.trustAllTools, true);
  const trustTools = asString(record.trustTools, "").trim();
  const extraArgs = readExtraArgs(record);

  const args = ["chat", "--no-interactive"];

  if (model) args.push("--model", model);

  // --trust-tools overrides --trust-all-tools when explicitly set
  if (trustTools) {
    args.push(`--trust-tools=${trustTools}`);
  } else if (trustAllTools) {
    args.push("--trust-all-tools");
  }

  if (extraArgs.length > 0) args.push(...extraArgs);

  if (options.resumeSessionId) {
    args.push("--resume-id", options.resumeSessionId);
  }

  return { args, model };
}
