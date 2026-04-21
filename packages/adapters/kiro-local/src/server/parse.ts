/**
 * Parse Kiro CLI plain-text stdout/stderr output.
 *
 * Kiro CLI v2 does not emit structured JSON output or session IDs in
 * stdout/stderr. The session is stored internally and accessible only
 * via `kiro-cli chat --list-sessions`. Stdout contains the assistant
 * response prefixed with `> `. Stderr contains the trust banner and
 * a credits/time summary line like: ` ▸ Credits: 0.04 • Time: 2s`
 */

const RESPONSE_PREFIX_RE = /^>\s?/;
const ANSI_RE = /\x1b\[[?]?[0-9;]*[A-Za-z]|\x1b\].*?\x07/g;

/** Matches ` ▸ Credits: 0.04 • Time: 2s` or ` ▸ Credits: 11.70 • Time: 4m 10s` on stderr */
const CREDITS_RE = /Credits:\s*([\d.]+)/;
const TIME_RE = /Time:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s/;

export function parseKiroStdout(stdout: string): {
  summary: string;
  errorMessage: string | null;
} {
  let errorMessage: string | null = null;
  const lines: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    // Strip ANSI escape codes — Kiro CLI emits color codes even in --no-interactive mode
    const line = rawLine.replace(ANSI_RE, "").trim();
    if (!line) continue;

    // Capture the first error-like line (root cause)
    if (!errorMessage && (/^error:/i.test(line) || /^fatal:/i.test(line))) {
      errorMessage = line;
      continue;
    }

    // Strip the `> ` response prefix that kiro-cli adds to assistant output
    const cleaned = line.replace(RESPONSE_PREFIX_RE, "");
    if (cleaned) lines.push(cleaned);
  }

  const summary = lines.join("\n").trim();

  return { summary, errorMessage };
}

/**
 * Parse the credits and wall-clock time from Kiro CLI stderr.
 *
 * Kiro CLI prints a summary line on stderr like:
 *   ` ▸ Credits: 0.04 • Time: 2s`
 *
 * Returns null values when the line is not found.
 */
export function parseKiroCredits(stderr: string): {
  credits: number | null;
  timeSec: number | null;
} {
  // Strip ANSI escape codes before matching — Kiro CLI wraps the credits
  // line in color codes even in non-interactive mode.
  const clean = stderr.replace(ANSI_RE, "");
  const creditsMatch = clean.match(CREDITS_RE);
  const timeMatch = clean.match(TIME_RE);

  const credits = creditsMatch
    ? parseFloat(creditsMatch[1]!)
    : null;
  const timeSec = timeMatch
    ? (parseInt(timeMatch[1] ?? "0", 10) * 3600) + (parseInt(timeMatch[2] ?? "0", 10) * 60) + parseInt(timeMatch[3]!, 10)
    : null;

  return {
    credits: credits !== null && Number.isFinite(credits) ? credits : null,
    timeSec: timeSec !== null && Number.isFinite(timeSec) ? timeSec : null,
  };
}

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Session discovery via --list-sessions
// ---------------------------------------------------------------------------

const SESSION_LINE_RE = /Chat SessionId:\s*([0-9a-f-]{36})/i;

/**
 * Generate a short session marker to prepend to the prompt.
 * Format: `pcsid:<6 hex chars><unix seconds base36>` — short enough to be
 * negligible in the context window, unique enough to match in --list-sessions.
 */
export function generateSessionMarker(): string {
  const hex = randomBytes(3).toString("hex");
  const ts = Math.floor(Date.now() / 1000).toString(36);
  return `pcsid:${hex}${ts}`;
}

/**
 * Parse `kiro-cli chat --list-sessions` output and find the session
 * whose prompt preview contains the given marker.
 */
export function matchSessionByMarker(
  listOutput: string,
  marker: string,
): string | null {
  const lines = listOutput.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const idMatch = line.match(SESSION_LINE_RE);
    if (!idMatch) continue;
    // The next line(s) contain the prompt preview — check the surrounding
    // context for our marker. list-sessions format:
    //   Chat SessionId: <uuid>
    //     <time ago> | <prompt preview> | <N msgs> | <version>
    const nextLine = lines[i + 1] ?? "";
    if (nextLine.includes(marker)) {
      return idMatch[1]!;
    }
  }
  return null;
}

/**
 * Run `kiro-cli chat --list-sessions` and extract the session ID whose
 * prompt contains the given marker. Returns null if not found or if the
 * command fails.
 */
export async function discoverSessionId(
  command: string,
  cwd: string,
  env: Record<string, string>,
  marker: string,
  runChildProcessFn: typeof import("@paperclipai/adapter-utils/server-utils").runChildProcess,
): Promise<string | null> {
  try {
    const proc = await runChildProcessFn(
      `kiro-session-discover-${Date.now()}`,
      command,
      ["chat", "--list-sessions"],
      {
        cwd,
        env,
        timeoutSec: 10,
        graceSec: 2,
        onLog: async () => {},
      },
    );
    if ((proc.exitCode ?? 1) !== 0) return null;
    // Kiro CLI outputs --list-sessions to stderr, not stdout
    const output = proc.stderr || proc.stdout;
    return matchSessionByMarker(output, marker);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auth pre-flight via `kiro-cli whoami`
// ---------------------------------------------------------------------------

/**
 * Run `kiro-cli whoami` to check if the CLI is authenticated.
 * Returns true if authenticated, false if not or if the command fails.
 * This is much faster and more reliable than waiting for the chat command
 * to hang on an interactive login prompt.
 */
export async function checkKiroAuth(
  command: string,
  cwd: string,
  env: Record<string, string>,
  runChildProcessFn: typeof import("@paperclipai/adapter-utils/server-utils").runChildProcess,
): Promise<{ authenticated: boolean; detail: string | null }> {
  try {
    const proc = await runChildProcessFn(
      `kiro-auth-check-${Date.now()}`,
      command,
      ["whoami"],
      {
        cwd,
        env,
        timeoutSec: 10,
        graceSec: 2,
        onLog: async () => {},
      },
    );
    const output = `${proc.stdout}\n${proc.stderr}`.trim();
    if ((proc.exitCode ?? 1) === 0) {
      return { authenticated: true, detail: proc.stdout.trim() || null };
    }
    return { authenticated: false, detail: output || "Not logged in" };
  } catch {
    return { authenticated: false, detail: "Failed to run kiro-cli whoami" };
  }
}
