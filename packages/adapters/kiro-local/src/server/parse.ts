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

/** Matches ` ▸ Credits: 0.04 • Time: 2s` on stderr */
const CREDITS_RE = /Credits:\s*([\d.]+)/;
const TIME_RE = /Time:\s*(\d+)s/;

export function parseKiroStdout(stdout: string): {
  summary: string;
  errorMessage: string | null;
} {
  let errorMessage: string | null = null;
  const lines: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Capture error-like lines
    if (/^error:/i.test(line) || /^fatal:/i.test(line)) {
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
  const creditsMatch = stderr.match(CREDITS_RE);
  const timeMatch = stderr.match(TIME_RE);

  const credits = creditsMatch
    ? parseFloat(creditsMatch[1]!)
    : null;
  const timeSec = timeMatch
    ? parseInt(timeMatch[1]!, 10)
    : null;

  return {
    credits: credits !== null && Number.isFinite(credits) ? credits : null,
    timeSec: timeSec !== null && Number.isFinite(timeSec) ? timeSec : null,
  };
}

const KIRO_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid.*api[_\s-]?key|kiro[_\s-]?api[_\s-]?key.*required|please\s+run\s+`?kiro-cli\s+login`?)/i;

export function isKiroAuthRequired(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`;
  return KIRO_AUTH_REQUIRED_RE.test(haystack);
}

// ---------------------------------------------------------------------------
// Session discovery via --list-sessions
// ---------------------------------------------------------------------------

const SESSION_LINE_RE = /Chat SessionId:\s*([0-9a-f-]{36})/i;

/**
 * Generate a short session marker to prepend to the prompt.
 * Format: `pcsid:<6 hex chars><unix seconds>` — short enough to be
 * negligible in the context window, unique enough to match in --list-sessions.
 */
export function generateSessionMarker(): string {
  const hex = Math.random().toString(16).slice(2, 8);
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
    return matchSessionByMarker(proc.stdout, marker);
  } catch {
    return null;
  }
}
