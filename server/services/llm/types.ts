/**
 * Minimal contract every LLM backend must satisfy.
 *
 * Deliberately narrow: text in, text out. Prompt assembly, schema validation and
 * retry policy live above this line, so swapping the backend — today the Claude
 * Code CLI running on the owner's subscription, later a plain API key — touches
 * one class and nothing else.
 */
export interface LlmGenerationRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface LlmGenerationResult {
  /** Raw model text. Parsing and validation are the caller's job. */
  text: string;
  /** Provider that produced it, recorded on the draft for later comparison. */
  provider: string;
  model: string;
  durationMs: number;
}

export interface LlmProvider {
  readonly name: string;

  /**
   * Whether this provider can run at all — a missing binary, a missing key, an
   * expired login. Checked before generation so an unavailable backend degrades
   * to "no draft" instead of throwing into the caller.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Returns null when generation failed for any reason the caller should treat
   * as "no draft this time": timeout, non-zero exit, provider-side error. Real
   * programming errors still throw.
   */
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult | null>;
}
