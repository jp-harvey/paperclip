/**
 * Kiro CLI v2 outputs plain text (no structured JSON mode).
 * We print stdout lines as-is.
 */
export function printKiroStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (line) console.log(line);
}
