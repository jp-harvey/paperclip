import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
  AdapterExecutionContext,
} from "@paperclipai/adapter-utils";
import {
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
  ensurePaperclipSkillSymlink,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the `.kiro/skills/` directory inside the given cwd.
 * Kiro CLI discovers skills from this workspace-local directory.
 */
function resolveKiroSkillsDir(cwd: string): string {
  return path.join(cwd, ".kiro", "skills");
}

async function buildKiroSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const availableByKey = new Map(availableEntries.map((entry) => [entry.key, entry]));
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const desiredSet = new Set(desiredSkills);
  const entries: AdapterSkillEntry[] = availableEntries.map((entry) => ({
    key: entry.key,
    runtimeName: entry.runtimeName,
    desired: desiredSet.has(entry.key),
    managed: true,
    state: desiredSet.has(entry.key) ? "configured" : "available",
    origin: entry.required ? "paperclip_required" : "company_managed",
    originLabel: entry.required ? "Required by Paperclip" : "Managed by Paperclip",
    readOnly: false,
    sourcePath: entry.source,
    targetPath: null,
    detail: desiredSet.has(entry.key)
      ? "Will be linked into .kiro/skills/ in the working directory on the next run."
      : null,
    required: Boolean(entry.required),
    requiredReason: entry.requiredReason ?? null,
  }));
  const warnings: string[] = [];

  for (const desiredSkill of desiredSkills) {
    if (availableByKey.has(desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available from the Paperclip skills directory.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
      sourcePath: null,
      targetPath: null,
      detail: "Paperclip cannot find this skill in the local runtime skills directory.",
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));

  return {
    adapterType: "kiro_local",
    supported: true,
    mode: "ephemeral",
    desiredSkills,
    entries,
    warnings,
  };
}

export async function listKiroSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildKiroSkillSnapshot(ctx.config);
}

export async function syncKiroSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildKiroSkillSnapshot(ctx.config);
}

/**
 * Inject Paperclip-managed skills into `.kiro/skills/` before execution.
 * Creates symlinks from the bundled skill sources into the workspace.
 */
export async function ensureKiroSkillsInjected(
  cwd: string,
  config: Record<string, unknown>,
  onLog: AdapterExecutionContext["onLog"],
): Promise<void> {
  const allSkillsEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkillNames = resolvePaperclipDesiredSkillNames(config, allSkillsEntries);
  const desiredSet = new Set(desiredSkillNames);
  const skillsEntries = allSkillsEntries.filter((entry) => desiredSet.has(entry.key));
  if (skillsEntries.length === 0) return;

  const skillsHome = resolveKiroSkillsDir(cwd);
  await fs.mkdir(skillsHome, { recursive: true });

  for (const entry of skillsEntries) {
    const target = path.join(skillsHome, entry.runtimeName);
    try {
      const result = await ensurePaperclipSkillSymlink(entry.source, target);
      if (result === "skipped") continue;
      await onLog(
        "stdout",
        `[paperclip] ${result === "repaired" ? "Repaired" : "Injected"} Kiro skill "${entry.runtimeName}" into ${skillsHome}\n`,
      );
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Failed to inject Kiro skill "${entry.key}" into ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
