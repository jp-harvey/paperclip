/**
 * Parse Kiro CLI plain-text stdout output.
 *
 * Kiro CLI v2 does not support structured JSON output, so we extract what we
 * can from the human-readable text: session IDs, error messages, and the final
 * assistant summary.
 */

const SESSION_ID_RE = /\bsession[:\s]+([0-9a-f-]{36})\b/i;

export function parseKiroStdout(stdout: string): {
  sessionId: string | null;
  summary: string;
  errorMessage: string | null;
} {
  let sessionId: string | null = null;
  let errorMessage: string | null = null;
  const lines: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Try to extract a session id from early output
    if (!sessionId) {
      const match = line.match(SESSION_ID_RE);
      if (match) {
        sessionId = match[1]!;
        continue;
      }
    }

    // Capture error-like lines
    if (/^error:/i.test(line) || /^fatal:/i.test(line)) {
      errorMessage = line;
      continue;
    }

    lines.push(line);
  }

  // Use the last non-empty lines as the summary (the assistant's final response)
  const summary = lines.slice(-20).join("\n").trim();

  return { sessionId, summary, errorMessage };
}

const KIRO_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid.*api[_\s-]?key|kiro[_\s-]?api[_\s-]?key.*required|please\s+run\s+`?kiro-cli\s+login`?)/i;

export function isKiroAuthRequired(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`;
  return KIRO_AUTH_REQUIRED_RE.test(haystack);
}

export function isKiroUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`;
  return /unknown session|session .* not found|conversation .* not found/i.test(haystack);
}
