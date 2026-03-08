/**
 * Guardrails — input/output validation for agent interactions.
 *
 * Provides built-in safety checks (prompt injection detection, PII detection,
 * length limits) and supports custom regex/keyword rules defined in
 * AgentConfig.guardrailRules.
 */

import type { GuardrailRule } from '@agentbuilder/core';
import type {
  ContentBlock,
  GuardrailsEngine,
  Message,
  TextBlock,
  ValidationResult,
  ValidationViolation,
} from './patterns/pattern.interface.js';

// ---------------------------------------------------------------------------
// Built-in detection patterns
// ---------------------------------------------------------------------------

/**
 * Heuristic patterns that indicate prompt injection attempts.
 * Each entry is [patternName, RegExp].
 */
const PROMPT_INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ['system_override', /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|rules?|directions?)/i],
  ['role_hijack', /you\s+are\s+now\s+(?:a|an|the)\s+(?:different|new|evil|unrestricted|unfiltered)/i],
  ['jailbreak_dan', /\bDAN\b.*\bdo\s+anything\s+now\b/i],
  ['jailbreak_developer', /(?:developer|debug|maintenance)\s+mode\s*(?:enabled|activated|on)/i],
  ['instruction_leak', /(?:repeat|print|show|display|reveal|output)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)/i],
  ['base64_injection', /(?:decode|eval|execute)\s+(?:the\s+)?(?:following\s+)?base64/i],
  ['delimiter_escape', /```\s*system\b/i],
];

/**
 * Common PII patterns. These are intentionally broad — real PII detection
 * would use a dedicated service, but these catch common leaks.
 */
const PII_PATTERNS: Array<[string, RegExp]> = [
  ['ssn', /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/],
  ['credit_card', /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/],
  ['phone_us', /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/],
  ['ip_address', /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/],
];

/** Default maximum message length (characters). */
const DEFAULT_MAX_LENGTH = 100_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract plain text from message content. */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Guardrails class
// ---------------------------------------------------------------------------

export class Guardrails implements GuardrailsEngine {
  private readonly enablePromptInjection: boolean;
  private readonly enablePiiDetection: boolean;
  private readonly maxInputLength: number;
  private readonly maxOutputLength: number;

  constructor(options?: GuardrailsOptions) {
    this.enablePromptInjection = options?.enablePromptInjection ?? true;
    this.enablePiiDetection = options?.enablePiiDetection ?? true;
    this.maxInputLength = options?.maxInputLength ?? DEFAULT_MAX_LENGTH;
    this.maxOutputLength = options?.maxOutputLength ?? DEFAULT_MAX_LENGTH;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Validate a user input message against built-in checks and custom rules.
   */
  validateInput(message: Message, rules: GuardrailRule[]): ValidationResult {
    const text = extractText(message.content);
    const violations: ValidationViolation[] = [];

    // Length check
    if (text.length > this.maxInputLength) {
      violations.push({
        ruleId: 'builtin:max_input_length',
        ruleName: 'Maximum input length',
        action: 'block',
        detail: `Input length ${text.length} exceeds maximum ${this.maxInputLength} characters.`,
      });
    }

    // Prompt injection detection
    if (this.enablePromptInjection) {
      for (const [name, pattern] of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(text)) {
          violations.push({
            ruleId: `builtin:prompt_injection:${name}`,
            ruleName: `Prompt injection: ${name}`,
            action: 'block',
            detail: `Potential prompt injection detected: ${name} pattern matched.`,
          });
        }
      }
    }

    // PII detection on input
    if (this.enablePiiDetection) {
      for (const [name, pattern] of PII_PATTERNS) {
        if (pattern.test(text)) {
          violations.push({
            ruleId: `builtin:pii:${name}`,
            ruleName: `PII detected: ${name}`,
            action: 'warn',
            detail: `Potential PII detected in input: ${name}.`,
          });
        }
      }
    }

    // Custom rules (input or both)
    const inputRules = rules
      .filter((r) => r.type === 'input' || r.type === 'both')
      .sort((a, b) => a.priority - b.priority);

    for (const rule of inputRules) {
      const violation = this.evaluateCustomRule(rule, text, 'input');
      if (violation) {
        violations.push(violation);
      }
    }

    return {
      passed: !violations.some((v) => v.action === 'block'),
      violations,
    };
  }

  /**
   * Validate an agent output response against built-in checks and custom rules.
   */
  validateOutput(response: string, rules: GuardrailRule[]): ValidationResult {
    const violations: ValidationViolation[] = [];

    // Length check
    if (response.length > this.maxOutputLength) {
      violations.push({
        ruleId: 'builtin:max_output_length',
        ruleName: 'Maximum output length',
        action: 'block',
        detail: `Output length ${response.length} exceeds maximum ${this.maxOutputLength} characters.`,
      });
    }

    // PII detection on output (agents should not leak PII)
    if (this.enablePiiDetection) {
      for (const [name, pattern] of PII_PATTERNS) {
        if (pattern.test(response)) {
          violations.push({
            ruleId: `builtin:pii:${name}`,
            ruleName: `PII detected: ${name}`,
            action: 'warn',
            detail: `Potential PII detected in output: ${name}. Consider redacting.`,
          });
        }
      }
    }

    // Custom rules (output or both)
    const outputRules = rules
      .filter((r) => r.type === 'output' || r.type === 'both')
      .sort((a, b) => a.priority - b.priority);

    for (const rule of outputRules) {
      const violation = this.evaluateCustomRule(rule, response, 'output');
      if (violation) {
        violations.push(violation);
      }
    }

    return {
      passed: !violations.some((v) => v.action === 'block'),
      violations,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Evaluate a custom guardrail rule against the given text.
   *
   * The rule's `check` field is interpreted as:
   * - If it starts with `/`, it is treated as a regex (e.g., `/badword/i`).
   * - If it starts with `keywords:`, the remainder is a comma-separated list
   *   of keywords to match.
   * - Otherwise it is treated as a literal substring match.
   */
  private evaluateCustomRule(
    rule: GuardrailRule,
    text: string,
    direction: 'input' | 'output',
  ): ValidationViolation | null {
    const check = rule.check.trim();
    let matched = false;

    if (check.startsWith('/')) {
      // Regex mode: parse /pattern/flags
      const lastSlash = check.lastIndexOf('/');
      if (lastSlash > 0) {
        const pattern = check.slice(1, lastSlash);
        const flags = check.slice(lastSlash + 1);
        try {
          const regex = new RegExp(pattern, flags);
          matched = regex.test(text);
        } catch {
          // If regex is invalid, skip the rule silently.
          return null;
        }
      }
    } else if (check.startsWith('keywords:')) {
      const keywords = check
        .slice('keywords:'.length)
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      const lowerText = text.toLowerCase();
      matched = keywords.some((kw) => lowerText.includes(kw));
    } else {
      // Literal substring
      matched = text.toLowerCase().includes(check.toLowerCase());
    }

    if (!matched) return null;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      detail: `${direction} guardrail "${rule.name}" triggered: ${rule.description}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GuardrailsOptions {
  /** Enable built-in prompt injection detection. Default: true. */
  enablePromptInjection?: boolean;
  /** Enable built-in PII pattern detection. Default: true. */
  enablePiiDetection?: boolean;
  /** Maximum allowed input length in characters. Default: 100 000. */
  maxInputLength?: number;
  /** Maximum allowed output length in characters. Default: 100 000. */
  maxOutputLength?: number;
}
