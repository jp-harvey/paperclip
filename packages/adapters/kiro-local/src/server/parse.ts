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
