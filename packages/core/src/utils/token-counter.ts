/**
 * Token estimation utility.
 *
 * Provides fast, dependency-free token count estimation using character-based
 * heuristics. For production accuracy, use a proper tokenizer (tiktoken, etc.);
 * this utility is designed for quick budget checks and context-window guards.
 */

/**
 * Error thrown when token estimation fails.
 */
export class TokenCountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCountError';
  }
}

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
 * Validate that a value is a finite positive number.
 *
 * @param value - The value to validate.
 * @param label - Label for error messages.
 * @throws {TokenCountError} If validation fails.
 */
function validatePositiveNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TokenCountError(`${label} must be a finite non-negative number, got: ${String(value)}`);
  }
}

/**
 * Validate that a value is a string.
 *
 * @param value - The value to validate.
 * @param label - Label for error messages.
 * @throws {TokenCountError} If validation fails.
 */
function validateString(value: unknown, label: string): void {
  if (typeof value !== 'string') {
    throw new TokenCountError(`${label} must be a string, got: ${typeof value}`);
  }
}

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
 * @throws {TokenCountError} If text is not a string.
 *
 * @example
 * ```ts
 * estimateTokens('Hello, world!');                     // ~4
 * estimateTokens('Hello, world!', 'claude-sonnet-4-20250514'); // ~4
 * ```
 */
export function estimateTokens(text: string, model?: string): number {
  validateString(text, 'text');

  if (text.length === 0) {
    return 0;
  }

  const ratio = getRatio(model);
  const estimate = Math.ceil(text.length / ratio);

  if (!Number.isFinite(estimate)) {
    throw new TokenCountError(`Token estimation produced invalid result for text of length ${text.length}`);
  }

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
 * @throws {TokenCountError} If messages array is invalid or content format is unexpected.
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  model?: string,
): number {
  if (!Array.isArray(messages)) {
    throw new TokenCountError('messages must be an array');
  }

  const PER_MESSAGE_OVERHEAD = 4; // ~4 tokens for role, delimiters, etc.
  let total = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!msg || typeof msg !== 'object') {
      throw new TokenCountError(`messages[${i}] must be an object, got: ${typeof msg}`);
    }

    if (typeof msg.role !== 'string') {
      throw new TokenCountError(`messages[${i}].role must be a string, got: ${typeof msg.role}`);
    }

    total += PER_MESSAGE_OVERHEAD;

    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content, model);
    } else if (Array.isArray(msg.content)) {
      // Sum text from all text-type blocks
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];

        if (!block || typeof block !== 'object') {
          throw new TokenCountError(`messages[${i}].content[${j}] must be an object, got: ${typeof block}`);
        }

        if (typeof block.type !== 'string') {
          throw new TokenCountError(`messages[${i}].content[${j}].type must be a string, got: ${typeof block.type}`);
        }

        if (block.type === 'text' && block.text) {
          if (typeof block.text !== 'string') {
            throw new TokenCountError(`messages[${i}].content[${j}].text must be a string, got: ${typeof block.text}`);
          }
          total += estimateTokens(block.text, model);
        }
        // Image blocks contribute a fixed token budget (~1000 tokens typical)
        if (block.type === 'image' || block.type === 'image_url') {
          total += 1000;
        }
      }
    } else if (msg.content !== undefined) {
      throw new TokenCountError(`messages[${i}].content must be a string or array, got: ${typeof msg.content}`);
    }
  }

  // System overhead (~2 tokens for the conversation frame)
  total += 2;

  if (!Number.isFinite(total) || total < 0) {
    throw new TokenCountError(`Token estimation produced invalid total: ${total}`);
  }

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
 * @throws {TokenCountError} If parameters are invalid or estimation fails.
 */
export function fitsInContext(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  contextWindow: number,
  reserveForOutput: number = 4096,
  model?: string,
): { fits: boolean; estimatedTokens: number; availableTokens: number } {
  validatePositiveNumber(contextWindow, 'contextWindow');
  validatePositiveNumber(reserveForOutput, 'reserveForOutput');

  if (contextWindow < reserveForOutput) {
    throw new TokenCountError(`contextWindow (${contextWindow}) must be >= reserveForOutput (${reserveForOutput})`);
  }

  const estimatedTokens = estimateMessagesTokens(messages, model);
  const availableTokens = contextWindow - reserveForOutput;

  return {
    fits: estimatedTokens <= availableTokens,
    estimatedTokens,
    availableTokens,
  };
}
