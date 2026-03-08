/**
 * Detailed message and content block type definitions.
 * Re-exports the canonical types from llm.ts and provides helper utilities
 * for working with message content.
 */

import type {
  ContentBlock,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  Message,
  MessageRole,
} from './llm.js';

// Re-export canonical types so consumers can import from either module.
export type {
  ContentBlock,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  Message,
  MessageRole,
};

/** Valid message roles. */
export type Role = MessageRole;

/**
 * A structured message with additional tracking fields beyond the base Message.
 */
export interface StructuredMessage extends Message {
  /** Unique message ID for tracking. */
  id?: string;
  /** Timestamp when the message was created. */
  timestamp?: Date;
  /** Arbitrary metadata attached to the message. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Extract the text from a message's content, concatenating all text blocks.
 * Useful for logging or guardrail checks.
 */
export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Extract all tool-call blocks from a message's content.
 */
export function extractToolCallBlocks(content: string | ContentBlock[]): ToolCallContent[] {
  if (typeof content === 'string') {
    return [];
  }
  return content.filter((block): block is ToolCallContent => block.type === 'tool_call');
}

/**
 * Extract all tool-result blocks from a message's content.
 */
export function extractToolResultBlocks(content: string | ContentBlock[]): ToolResultContent[] {
  if (typeof content === 'string') {
    return [];
  }
  return content.filter((block): block is ToolResultContent => block.type === 'tool_result');
}

/**
 * Create a simple text message.
 */
export function createTextMessage(role: Role, text: string): StructuredMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  };
}

/**
 * Create a tool-result message.
 */
export function createToolResultMessage(
  toolCallId: string,
  output: string,
  isError = false,
): StructuredMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool_result',
        toolCallId,
        content: output,
        isError,
      },
    ],
  };
}
