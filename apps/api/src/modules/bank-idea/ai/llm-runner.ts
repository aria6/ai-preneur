/**
 * The one thing Bank Idea needs from an AI provider: run a prompt and return its text.
 * Prompts, parsing and scoring stay provider-independent, so moving from the Claude
 * Code CLI to the Anthropic API later only means another LlmRunner.
 */
export interface LlmRunOptions {
  /** `web` allows web search + fetching pages; `none` allows no tools at all. */
  tools: 'web' | 'none';
  timeoutMs: number;
  /** Upper bound of agentic turns (tool calls + answers). */
  maxTurns: number;
  signal?: AbortSignal;
}

export interface LlmRunResult {
  text: string;
  /** Provider details worth keeping (cost, turns, model). Informational only. */
  meta: Record<string, unknown>;
}

export interface LlmRunner {
  run(prompt: string, options: LlmRunOptions): Promise<LlmRunResult>;
}

/** A failure whose message can be shown to the user as is (Indonesian). */
export class AiError extends Error {
  constructor(
    message: string,
    /** Stopped on purpose (shutdown or cancel), not a real failure. */
    readonly aborted = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
