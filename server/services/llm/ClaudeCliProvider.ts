import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import type { LlmGenerationRequest, LlmGenerationResult, LlmProvider } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Shape of the `--output-format json` envelope. Only the fields we rely on;
 * the CLI returns considerably more (token usage, timings, session id).
 */
interface ClaudeCliEnvelope {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: string | null;
}

/**
 * Generates text through the Claude Code CLI, using the owner's existing login.
 *
 * This is the no-API-key path: `claude` is already installed and authenticated
 * on the host, and the app runs as the same user, so it can reuse that session.
 * It is a legitimate starting point at this volume — a couple of guest emails a
 * month — but it is not an inference backend with a throughput guarantee. When
 * an API key becomes available, swap in a provider built on the Anthropic SDK;
 * nothing above `LlmProvider` changes.
 *
 * Two properties matter for correctness here:
 *
 *  - **Neutral working directory.** Run from a temp dir, never the project, so
 *    the CLI does not pick up CLAUDE.md, skills or repo context and quietly
 *    change the model's behaviour.
 *  - **Serialised calls.** One generation at a time. A burst of guest emails
 *    must not spawn a process per message.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = "claude-cli";

  private readonly model: string;
  private readonly timeoutMs: number;
  /** Tail of the in-flight chain; every call awaits its predecessor. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { model?: string; timeoutMs?: number } = {}) {
    this.model = options.model ?? process.env.GUEST_REPLY_LLM_MODEL ?? "claude-opus-5";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.GUEST_REPLY_LLM_TIMEOUT_MS ?? 120_000);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("claude", ["--version"], { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult | null> {
    const run = this.queue.then(
      () => this.runOnce(request),
      () => this.runOnce(request)
    );
    // Keep the chain alive regardless of this call's outcome, or one failure
    // would reject every queued generation behind it.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runOnce(request: LlmGenerationRequest): Promise<LlmGenerationResult | null> {
    const startedAt = Date.now();

    const args = [
      "-p", request.userPrompt,
      "--output-format", "json",
      "--system-prompt", request.systemPrompt,
      "--model", this.model,
      // Nothing here needs tools, and a tool call would stall a headless run.
      "--disallowed-tools", "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task",
    ];

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("claude", args, {
        cwd: os.tmpdir(),
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (err) {
      console.error(`[ClaudeCliProvider] Generation failed after ${Date.now() - startedAt}ms:`, err);
      return null;
    }

    let envelope: ClaudeCliEnvelope;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      console.error("[ClaudeCliProvider] Could not parse CLI output as JSON.");
      return null;
    }

    // The CLI exits 0 on model-side failures too, so the envelope — not the exit
    // code — is what says whether we actually got an answer.
    if (envelope.is_error || envelope.subtype !== "success" || envelope.api_error_status) {
      console.error(
        `[ClaudeCliProvider] CLI reported failure (subtype=${envelope.subtype}, api_error=${envelope.api_error_status}).`
      );
      return null;
    }

    const text = (envelope.result ?? "").trim();
    if (!text) {
      console.error("[ClaudeCliProvider] CLI returned an empty result.");
      return null;
    }

    return {
      text,
      provider: this.name,
      model: this.model,
      durationMs: Date.now() - startedAt,
    };
  }
}
