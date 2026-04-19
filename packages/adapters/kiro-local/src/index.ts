export const type = "kiro_local";
export const label = "Kiro CLI (local)";

export const models = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-20250414", label: "Claude Haiku 4.5" },
];

export const agentConfigurationDoc = `# kiro_local agent configuration

Adapter: kiro_local

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the prompt at runtime
- model (string, optional): model id to pass via --model
- promptTemplate (string, optional): run prompt template
- trustAllTools (boolean, optional): pass --trust-all-tools to auto-approve all tool calls (default: true)
- trustTools (string, optional): comma-separated tool names for --trust-tools (overrides trustAllTools when set)
- command (string, optional): defaults to "kiro-cli"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- workspaceStrategy (object, optional): execution workspace strategy

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (default: 0 — no timeout)
- graceSec (number, optional): SIGTERM grace period in seconds (default: 15)

Authentication:
- Kiro CLI supports two authentication modes:
  1. API key: set KIRO_API_KEY in adapter env or server environment for headless/CI usage
  2. Interactive login: run \`kiro-cli login\` on the host for subscription-based auth
- Both modes work with the --no-interactive flag used by Paperclip

Notes:
- Prompts are passed as the positional INPUT argument to \`kiro-cli chat\`.
- The --no-interactive flag is always set for headless execution.
- Session resume uses --resume-id <session_id>.
- Kiro CLI does not currently support structured JSON output; stdout is parsed as plain text.
- When not authenticated, Kiro CLI may launch an interactive login prompt that hangs in headless mode. A pre-flight \`kiro-cli whoami\` check prevents this by failing fast with an actionable error. Run \`kiro-cli login\` or set KIRO_API_KEY before using this adapter.
`;
