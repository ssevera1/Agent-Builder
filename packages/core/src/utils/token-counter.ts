/**
 * Token estimation utility.
 *
 * Provides fast, dependency-free token count estimation using character-based
 * heuristics. For production accuracy, use a proper tokenizer (tiktoken, etc.);
 * this utility is designed for quick budget checks and context-window guards.
 */

/**
 * Model-family token ratios: average characters per token.
 * These are empirical approximations for English text.
 */
const MODEL_RATIOS: Record<string, number> = {
  // Anthropic models — Claude tokenizer averages ~3.5-4 chars/token for English
  'claude': 3.7,

  // OpenAI models — GPT tokenizer (cl100k_base) averages ~4 chars/token
  'gpt': 4.0,

  // Llama / Meta models
  'llama': 3.8,

  // Mistral models
  'mistral': 3.8,

  // Google Gemini
  'gemini': 4.0,

  // Fallback for unknown models
  'default': 4.0,
};

/**
 * Resolve the characters-per-token ratio for a given model identifier.
 * Matches on prefix (e.g., "claude-sonnet-4-20250514" matches "claude").
 */
function getRatio(model?: string): number {
  if (!model) {
    return MODEL_RATIOS['default']!;
  }

  const lowerModel = model.toLowerCase();

  for (const [prefix, ratio] of Object.entries(MODEL_RATIOS)) {
    if (prefix !== 'default' && lowerModel.includes(prefix)) {
      return ratio;
    }
  }

  return MODEL_RATIOS['default']!;
}

/**
 * Estimate the number of tokens in a text string.
 *
 * @param text - The text to estimate tokens for.
 * @param model - Optional model identifier for model-specific ratios.
 * @returns Estimated token count (always at least 1 for non-empty strings).
 *
 * @example
 * ```ts
 * estimateTokens('Hello, world!');                     // ~4
 * estimateTokens('Hello, world!', 'claude-sonnet-4-20250514'); // ~4
 * ```
 */
export function estimateTokens(text: string, model?: string): number {
  if (text.length === 0) {
    return 0;
  }

  const ratio = getRatio(model);
  const estimate = Math.ceil(text.length / ratio);

  // Always return at least 1 token for non-empty strings
  return Math.max(1, estimate);
}

/**
 * Estimate the total tokens for an array of messages.
 * Adds a small per-message overhead to account for special tokens
 * (role markers, delimiters, etc.).
 *
 * @param messages - Array of objects with a `content` field (string or blocks).
 * @param model - Optional model identifier.
 * @returns Estimated total token count.
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  model?: string,
): number {
  const PER_MESSAGE_OVERHEAD = 4; // ~4 tokens for role, delimiters, etc.
  let total = 0;

  for (const msg of messages) {
    total += PER_MESSAGE_OVERHEAD;

    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content, model);
    } else {
      // Sum text from all text-type blocks
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          total += estimateTokens(block.text, model);
        }
        // Image blocks contribute a fixed token budget (~1000 tokens typical)
        if (block.type === 'image' || block.type === 'image_url') {
          total += 1000;
        }
      }
    }
  }

  // System overhead (~2 tokens for the conversation frame)
  total += 2;

  return total;
}

/**
 * Check whether a set of messages fits within a context window.
 *
 * @param messages - Messages to check.
 * @param contextWindow - Maximum context window in tokens.
 * @param reserveForOutput - Tokens to reserve for the model's output.
 * @param model - Optional model identifier.
 * @returns Object with `fits` boolean and the estimated input token count.
 */
export function fitsInContext(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  contextWindow: number,
  reserveForOutput: number = 4096,
  model?: string,
): { fits: boolean; estimatedTokens: number; availableTokens: number } {
  const estimatedTokens = estimateMessagesTokens(messages, model);
  const availableTokens = contextWindow - reserveForOutput;

  return {
    fits: estimatedTokens <= availableTokens,
    estimatedTokens,
    availableTokens,
  };
}
