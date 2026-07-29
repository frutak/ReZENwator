import { ClaudeCliProvider } from "./ClaudeCliProvider";
import type { LlmProvider } from "./types";

export type { LlmProvider, LlmGenerationRequest, LlmGenerationResult } from "./types";
export { ClaudeCliProvider } from "./ClaudeCliProvider";

let cached: LlmProvider | null = null;

/**
 * The provider this deployment should use.
 *
 * Today there is one: the Claude Code CLI on the owner's subscription. The
 * selection point exists anyway, because the migration to a plain API key is a
 * matter of when rather than whether — an `ANTHROPIC_API_KEY` in the
 * environment is the intended trigger, and adding that branch here is the only
 * change the rest of the system should see.
 */
export function getLlmProvider(): LlmProvider {
  if (!cached) cached = new ClaudeCliProvider();
  return cached;
}

/** Test seam. */
export function setLlmProvider(provider: LlmProvider | null): void {
  cached = provider;
}
