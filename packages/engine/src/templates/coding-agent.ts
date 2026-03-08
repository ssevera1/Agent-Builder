/**
 * Coding Agent Blueprint
 *
 * An expert software engineer that plans implementation, writes code,
 * and tests it. Uses the Plan-and-Execute pattern to break down coding
 * tasks into clear steps.
 *
 * Pattern: Plan-and-Execute
 * Tools: code_executor, file_system
 * Memory: Episodic for past coding sessions
 */

import type { AgentBlueprint } from '@agentbuilder/core';

export const CODING_AGENT_BLUEPRINT: AgentBlueprint = {
  id: 'coding-agent',
  name: 'Coding Agent',
  description:
    'An expert software engineer that plans implementation, writes clean ' +
    'and well-tested code, and iteratively improves it. Uses a plan-and-execute ' +
    'approach to break down coding tasks into manageable steps.',
  category: 'coding',
  pattern: 'plan-and-execute',

  defaultConfig: {
    name: 'Coding Agent',
    description: 'Expert software engineer with code execution and file system capabilities.',
    version: '1.0.0',
    pattern: 'plan-and-execute',
    systemPrompt: `You are an expert software engineer named {{agentName}}. You help users with coding tasks including writing, debugging, refactoring, and explaining code.

## Your Approach
1. **Understand the requirements**: Carefully analyze what the user needs. Ask clarifying questions if the requirements are ambiguous.
2. **Plan the implementation**: Break the task into clear steps. Identify the files, modules, and dependencies involved.
3. **Write clean code**: Follow best practices for the language/framework. Prefer readability over cleverness.
4. **Test your work**: Write or run tests to verify correctness. Execute code when possible to catch errors.
5. **Explain your decisions**: Help the user understand the design choices and trade-offs.

## Coding Principles
- Follow the single responsibility principle — keep functions and classes focused.
- Write descriptive variable and function names.
- Add comments only where the "why" is not obvious from the code.
- Handle errors gracefully — never let exceptions go unhandled.
- Prefer composition over inheritance.
- Use established patterns (not clever hacks) for maintainability.
- Include type annotations when the language supports them.

## Response Format
- Start with a brief summary of your plan.
- Present code in properly formatted code blocks with language tags.
- Explain key design decisions inline.
- Highlight any assumptions or limitations.
- Suggest tests or next steps when appropriate.`,
    tools: ['code_executor', 'file_system'],
    temperature: 0.2,
    maxTokens: 4096,
    maxTurns: 10,
    metadata: {},
  },

  requiredTools: ['code_executor'],
  optionalTools: ['file_system'],

  memoryConfig: {
    shortTermMaxMessages: 30,
    longTermEnabled: false,
    longTermTopK: 0,
    episodicEnabled: true,
    episodicTopK: 5,
  },

  samplePrompts: [
    'Write a TypeScript function that implements a debounce utility with proper generic typing and cancellation support.',
    'I have a React component that re-renders too often. Here is the code — help me optimize it with proper memoization.',
    'Create a Python script that reads a CSV file, identifies duplicate rows based on email column, and writes a deduplicated version.',
  ],

  testCases: [
    {
      id: 'coding-basic-function',
      name: 'Write a basic function with tests',
      input: 'Write a function that checks if a string is a valid palindrome, ignoring spaces and punctuation.',
      expectedOutput: 'function',
      maxLatencyMs: 30000,
    },
    {
      id: 'coding-execution',
      name: 'Code execution for verification',
      input: 'Write a Python function to find the nth Fibonacci number using memoization, and test it with n=10.',
      expectedToolCalls: ['code_executor'],
      maxLatencyMs: 45000,
    },
    {
      id: 'coding-debug',
      name: 'Debug and fix code',
      input: 'This JavaScript function should flatten a nested array but it crashes on deeply nested input: function flatten(arr) { return arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []); }',
      expectedOutput: 'stack',
      maxLatencyMs: 30000,
    },
  ],
};
