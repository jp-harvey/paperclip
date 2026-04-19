import type { AdapterModel } from "@paperclipai/adapter-utils";
import {
  asString,
  runChildProcess,
  ensurePathInEnv,
} from "@paperclipai/adapter-utils/server-utils";
import { models as staticModels } from "../index.js";

interface KiroModelEntry {
  model_id?: string;
  model_name?: string;
  description?: string;
}

/**
 * Dynamically list available Kiro CLI models by running
 * `kiro-cli chat --list-models --format json`.
 * Falls back to the static model list if the command fails.
 */
export async function listKiroModels(): Promise<AdapterModel[]> {
  try {
    const env = ensurePathInEnv({ ...process.env } as Record<string, string>);
    const proc = await runChildProcess(
      `kiro-list-models-${Date.now()}`,
      "kiro-cli",
      ["chat", "--list-models", "--format", "json"],
      {
        cwd: process.cwd(),
        env: {},
        timeoutSec: 15,
        graceSec: 2,
        onLog: async () => {},
      },
    );
    if ((proc.exitCode ?? 1) !== 0) return staticModels;

    const parsed = JSON.parse(proc.stdout.trim());
    if (!parsed || !Array.isArray(parsed.models)) return staticModels;

    const models: AdapterModel[] = parsed.models
      .filter((m: KiroModelEntry) => typeof m.model_id === "string" && m.model_id.length > 0)
      .map((m: KiroModelEntry) => ({
        id: m.model_id!,
        label: m.model_name ?? m.model_id!,
      }));

    return models.length > 0 ? models : staticModels;
  } catch {
    return staticModels;
  }
}
