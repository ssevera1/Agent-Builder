/**
 * Dataset loaders for test case files.
 *
 * Supports:
 * - JSONL: one JSON test case per line
 * - JSON: array of test cases
 * - CSV: columns id, name, input, expected_output
 */

import type { TestCase } from './types.js';
import type { Message } from '@agentbuilder/core';

// ─── Validation ─────────────────────────────────────────────────────────────

export interface DatasetValidationResult {
  valid: boolean;
  errors: Array<{ index: number; message: string }>;
  warnings: Array<{ index: number; message: string }>;
  totalCases: number;
  validCases: number;
}

/**
 * Validate an array of test cases for completeness and correctness.
 */
export function validateTestCases(cases: TestCase[]): DatasetValidationResult {
  const errors: Array<{ index: number; message: string }> = [];
  const warnings: Array<{ index: number; message: string }> = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]!;

    // Required fields
    if (!tc.id || typeof tc.id !== 'string') {
      errors.push({ index: i, message: 'Missing or invalid "id" field' });
    } else if (seenIds.has(tc.id)) {
      errors.push({ index: i, message: `Duplicate test case ID: "${tc.id}"` });
    } else {
      seenIds.add(tc.id);
    }

    if (!tc.name || typeof tc.name !== 'string') {
      errors.push({ index: i, message: 'Missing or invalid "name" field' });
    }

    if (!tc.input) {
      errors.push({ index: i, message: 'Missing "input" field' });
    } else if (!tc.input.role || !tc.input.content) {
      errors.push({ index: i, message: 'Invalid "input": must have role and content' });
    }

    // Warnings for best practices
    if (!tc.expectedOutput && !tc.expectedToolCalls && (!tc.assertions || tc.assertions.length === 0)) {
      warnings.push({ index: i, message: 'No expected output, tool calls, or assertions defined' });
    }

    if (tc.assertions) {
      for (let j = 0; j < tc.assertions.length; j++) {
        const assertion = tc.assertions[j]!;
        if (!assertion.type) {
          errors.push({
            index: i,
            message: `Assertion ${j}: missing "type" field`,
          });
        }
      }
    }
  }

  const validCases = cases.length - new Set(errors.map((e) => e.index)).size;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalCases: cases.length,
    validCases,
  };
}

// ─── JSONL Loader ───────────────────────────────────────────────────────────

/**
 * Load test cases from a JSONL file (one JSON object per line).
 *
 * Each line should be a JSON object with at minimum:
 * - id: string
 * - name: string
 * - input: string (will be wrapped in a Message) or Message object
 *
 * @param filePath - Path to the JSONL file.
 * @returns Array of parsed TestCase objects.
 */
export async function loadFromJSONL(filePath: string): Promise<TestCase[]> {
  const { readFile } = await import('node:fs/promises');

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Dataset file not found: ${filePath}`);
    }
    throw new Error(`Failed to read dataset file: ${(err as Error).message}`);
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const testCases: TestCase[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const raw = JSON.parse(lines[i]!) as Record<string, unknown>;
      testCases.push(normalizeTestCase(raw, i));
    } catch (err) {
      throw new Error(
        `Failed to parse line ${i + 1} in JSONL file: ${(err as Error).message}`
      );
    }
  }

  return testCases;
}

// ─── JSON Loader ────────────────────────────────────────────────────────────

/**
 * Load test cases from a JSON file containing an array of test case objects.
 *
 * @param filePath - Path to the JSON file.
 * @returns Array of parsed TestCase objects.
 */
export async function loadFromJSON(filePath: string): Promise<TestCase[]> {
  const { readFile } = await import('node:fs/promises');

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Dataset file not found: ${filePath}`);
    }
    throw new Error(`Failed to read dataset file: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON in dataset file: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('JSON dataset must be an array of test cases');
  }

  return (parsed as Array<Record<string, unknown>>).map((raw, i) =>
    normalizeTestCase(raw, i),
  );
}

// ─── CSV Loader ─────────────────────────────────────────────────────────────

/**
 * Load test cases from a CSV file with columns: id, name, input, expected_output.
 *
 * Supports:
 * - Quoted fields with commas inside
 * - Escaped quotes (double-quoting: "")
 * - Optional header row (auto-detected)
 *
 * @param filePath - Path to the CSV file.
 * @returns Array of parsed TestCase objects.
 */
export async function loadFromCSV(filePath: string): Promise<TestCase[]> {
  const { readFile } = await import('node:fs/promises');

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Dataset file not found: ${filePath}`);
    }
    throw new Error(`Failed to read dataset file: ${(err as Error).message}`);
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  // Parse header row
  const headerLine = lines[0]!;
  const headers = parseCSVLine(headerLine).map((h) => h.trim().toLowerCase());

  // Determine column indices
  const idIdx = headers.indexOf('id');
  const nameIdx = headers.indexOf('name');
  const inputIdx = headers.indexOf('input');
  const expectedIdx = headers.indexOf('expected_output');
  const toolsIdx = headers.indexOf('expected_tool_calls');
  const tagsIdx = headers.indexOf('tags');
  const maxLatencyIdx = headers.indexOf('max_latency_ms');

  // Check if the first row looks like a header
  const isHeader =
    idIdx >= 0 || nameIdx >= 0 || inputIdx >= 0 || expectedIdx >= 0;

  const dataLines = isHeader ? lines.slice(1) : lines;
  const testCases: TestCase[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseCSVLine(dataLines[i]!);

    const id = getField(fields, idIdx, `test_${i + 1}`);
    const name = getField(fields, nameIdx, `Test Case ${i + 1}`);
    const inputStr = getField(fields, inputIdx, '');
    const expectedOutput = getField(fields, expectedIdx);
    const toolCallsStr = getField(fields, toolsIdx);
    const tagsStr = getField(fields, tagsIdx);
    const maxLatencyStr = getField(fields, maxLatencyIdx);

    const input: Message = { role: 'user', content: inputStr };

    const testCase: TestCase = {
      id,
      name,
      input,
      expectedOutput: expectedOutput || undefined,
      expectedToolCalls: toolCallsStr
        ? toolCallsStr.split(';').map((t) => t.trim()).filter((t) => t)
        : undefined,
      tags: tagsStr
        ? tagsStr.split(';').map((t) => t.trim()).filter((t) => t)
        : undefined,
      maxLatencyMs: maxLatencyStr ? parseInt(maxLatencyStr, 10) : undefined,
    };

    testCases.push(testCase);
  }

  return testCases;
}

// ─── CSV Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line, handling quoted fields and escaped quotes.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i]!;

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        fields.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  fields.push(current);
  return fields;
}

function getField(
  fields: string[],
  index: number,
  defaultValue?: string,
): string {
  if (index < 0 || index >= fields.length) return defaultValue ?? '';
  return fields[index]?.trim() ?? defaultValue ?? '';
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize a raw JSON object into a TestCase, handling various input formats.
 */
function normalizeTestCase(
  raw: Record<string, unknown>,
  index: number,
): TestCase {
  const id = (raw['id'] as string) ?? `test_${index + 1}`;
  const name = (raw['name'] as string) ?? `Test Case ${index + 1}`;

  // Normalize the input field
  let input: Message;
  if (typeof raw['input'] === 'string') {
    input = { role: 'user', content: raw['input'] };
  } else if (raw['input'] && typeof raw['input'] === 'object') {
    const inputObj = raw['input'] as Record<string, unknown>;
    input = {
      role: (inputObj['role'] as Message['role']) ?? 'user',
      content: (inputObj['content'] as string) ?? '',
    };
  } else {
    input = { role: 'user', content: '' };
  }

  return {
    id,
    name,
    input,
    expectedOutput: raw['expectedOutput'] as string | undefined
      ?? raw['expected_output'] as string | undefined,
    expectedToolCalls: raw['expectedToolCalls'] as string[] | undefined
      ?? raw['expected_tool_calls'] as string[] | undefined,
    assertions: raw['assertions'] as TestCase['assertions'] | undefined,
    maxLatencyMs: raw['maxLatencyMs'] as number | undefined
      ?? raw['max_latency_ms'] as number | undefined,
    maxCost: raw['maxCost'] as number | undefined
      ?? raw['max_cost'] as number | undefined,
    tags: raw['tags'] as string[] | undefined,
    metadata: raw['metadata'] as Record<string, unknown> | undefined,
  };
}
