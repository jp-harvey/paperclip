import { type TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Parse a single Kiro CLI stdout line into transcript entries.
 *
 * Kiro CLI v2 does not emit structured JSON, so every line is treated as
 * plain stdout text. If Kiro CLI adds a --json or --output-format flag in
 * the future, this parser can be upgraded to produce richer transcript
 * entries (tool_call, thinking, result, etc.).
 */
export function parseKiroStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  return [{ kind: "stdout", ts, text: trimmed }];
}
