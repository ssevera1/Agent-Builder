/**
 * Calculator tool — safe mathematical expression evaluator.
 *
 * Uses a hand-written tokenizer and recursive-descent parser to evaluate
 * arithmetic expressions **without** `eval` or `Function`.
 *
 * Supported:
 *   Operators : +  -  *  /  ^  %
 *   Functions : sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round, exp
 *   Constants : pi, e
 *   Grouping  : ( )
 *   Unary     : -
 */

import { z } from 'zod';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Public schema
// ---------------------------------------------------------------------------

export const calculatorInputSchema = z.object({
  expression: z.string().min(1).describe('Mathematical expression to evaluate'),
});

export type CalculatorInput = z.infer<typeof calculatorInputSchema>;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

enum TokenType {
  Number = 'Number',
  Identifier = 'Identifier',
  Plus = 'Plus',
  Minus = 'Minus',
  Star = 'Star',
  Slash = 'Slash',
  Caret = 'Caret',
  Percent = 'Percent',
  LParen = 'LParen',
  RParen = 'RParen',
  Comma = 'Comma',
  EOF = 'EOF',
}

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number (integer or float)
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < input.length && /[0-9]/.test(input[i + 1]!))) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        num += input[i]!;
        i++;
      }
      // Support scientific notation like 1e3, 2.5e-4
      if (i < input.length && (input[i] === 'e' || input[i] === 'E')) {
        num += input[i]!;
        i++;
        if (i < input.length && (input[i] === '+' || input[i] === '-')) {
          num += input[i]!;
          i++;
        }
        while (i < input.length && /[0-9]/.test(input[i]!)) {
          num += input[i]!;
          i++;
        }
      }
      tokens.push({ type: TokenType.Number, value: num });
      continue;
    }

    // Identifier (function name or constant)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i]!)) {
        ident += input[i]!;
        i++;
      }
      tokens.push({ type: TokenType.Identifier, value: ident.toLowerCase() });
      continue;
    }

    // Single-character operators
    switch (ch) {
      case '+':
        tokens.push({ type: TokenType.Plus, value: '+' });
        break;
      case '-':
        tokens.push({ type: TokenType.Minus, value: '-' });
        break;
      case '*':
        tokens.push({ type: TokenType.Star, value: '*' });
        break;
      case '/':
        tokens.push({ type: TokenType.Slash, value: '/' });
        break;
      case '^':
        tokens.push({ type: TokenType.Caret, value: '^' });
        break;
      case '%':
        tokens.push({ type: TokenType.Percent, value: '%' });
        break;
      case '(':
        tokens.push({ type: TokenType.LParen, value: '(' });
        break;
      case ')':
        tokens.push({ type: TokenType.RParen, value: ')' });
        break;
      case ',':
        tokens.push({ type: TokenType.Comma, value: ',' });
        break;
      default:
        throw new Error(`Unexpected character: '${ch}' at position ${i}`);
    }
    i++;
  }

  tokens.push({ type: TokenType.EOF, value: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent
//
// Grammar (precedence low → high):
//   expr       → additive
//   additive   → multiplicative ( ('+' | '-') multiplicative )*
//   multiplicative → power ( ('*' | '/' | '%') power )*
//   power      → unary ( '^' power )?          (right-associative)
//   unary      → '-' unary | call
//   call       → IDENTIFIER '(' args ')' | primary
//   primary    → NUMBER | IDENTIFIER(constant) | '(' expr ')'
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '' };
  }

  private advance(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.advance();
    if (t.type !== type) {
      throw new Error(`Expected ${type} but got ${t.type} ("${t.value}")`);
    }
    return t;
  }

  // ── Constants & built-in functions ────────────────────────────────────

  private static readonly CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    e: Math.E,
  };

  private static readonly FUNCTIONS: Record<string, (...args: number[]) => number> = {
    sqrt: (x: number) => {
      if (x < 0) throw new Error('sqrt of negative number');
      return Math.sqrt(x);
    },
    sin: (x: number) => Math.sin(x),
    cos: (x: number) => Math.cos(x),
    tan: (x: number) => Math.tan(x),
    log: (x: number) => {
      if (x <= 0) throw new Error('log of non-positive number');
      return Math.log10(x);
    },
    ln: (x: number) => {
      if (x <= 0) throw new Error('ln of non-positive number');
      return Math.log(x);
    },
    abs: (x: number) => Math.abs(x),
    ceil: (x: number) => Math.ceil(x),
    floor: (x: number) => Math.floor(x),
    round: (x: number) => Math.round(x),
    exp: (x: number) => Math.exp(x),
    min: (...args: number[]) => Math.min(...args),
    max: (...args: number[]) => Math.max(...args),
    pow: (base: number, exp: number) => Math.pow(base, exp),
  };

  // ── Grammar rules ─────────────────────────────────────────────────────

  parse(): number {
    const result = this.additive();
    if (this.peek().type !== TokenType.EOF) {
      throw new Error(`Unexpected token "${this.peek().value}" after expression`);
    }
    return result;
  }

  private additive(): number {
    let left = this.multiplicative();

    while (
      this.peek().type === TokenType.Plus ||
      this.peek().type === TokenType.Minus
    ) {
      const op = this.advance();
      const right = this.multiplicative();
      left = op.type === TokenType.Plus ? left + right : left - right;
    }
    return left;
  }

  private multiplicative(): number {
    let left = this.power();

    while (
      this.peek().type === TokenType.Star ||
      this.peek().type === TokenType.Slash ||
      this.peek().type === TokenType.Percent
    ) {
      const op = this.advance();
      const right = this.power();
      if (op.type === TokenType.Star) {
        left = left * right;
      } else if (op.type === TokenType.Slash) {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        left = left % right;
      }
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    if (this.peek().type === TokenType.Caret) {
      this.advance();
      const exp = this.power(); // right-associative recursion
      return Math.pow(base, exp);
    }
    return base;
  }

  private unary(): number {
    if (this.peek().type === TokenType.Minus) {
      this.advance();
      return -this.unary();
    }
    if (this.peek().type === TokenType.Plus) {
      this.advance();
      return this.unary();
    }
    return this.call();
  }

  private call(): number {
    if (this.peek().type === TokenType.Identifier) {
      const name = this.peek().value;

      // Check if it's a function call (next token is '(')
      if (
        this.pos + 1 < this.tokens.length &&
        this.tokens[this.pos + 1]?.type === TokenType.LParen
      ) {
        this.advance(); // consume identifier
        this.advance(); // consume '('

        const args: number[] = [];
        if (this.peek().type !== TokenType.RParen) {
          args.push(this.additive());
          while (this.peek().type === TokenType.Comma) {
            this.advance(); // consume ','
            args.push(this.additive());
          }
        }
        this.expect(TokenType.RParen);

        const fn = Parser.FUNCTIONS[name];
        if (!fn) {
          throw new Error(`Unknown function: "${name}"`);
        }
        return fn(...args);
      }

      // Otherwise treat as a constant
      const constVal = Parser.CONSTANTS[name];
      if (constVal !== undefined) {
        this.advance();
        return constVal;
      }

      throw new Error(`Unknown identifier: "${name}"`);
    }

    return this.primary();
  }

  private primary(): number {
    const t = this.peek();

    if (t.type === TokenType.Number) {
      this.advance();
      const n = Number(t.value);
      if (isNaN(n)) throw new Error(`Invalid number: "${t.value}"`);
      return n;
    }

    if (t.type === TokenType.LParen) {
      this.advance();
      const val = this.additive();
      this.expect(TokenType.RParen);
      return val;
    }

    throw new Error(`Unexpected token: "${t.value}" (${t.type})`);
  }
}

// ---------------------------------------------------------------------------
// Evaluate helper
// ---------------------------------------------------------------------------

export function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createCalculatorTool(): RegisteredTool {
  return {
    name: 'calculator',
    description:
      'Evaluate a mathematical expression safely. Supports: +, -, *, /, ^, %, sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round, exp, min, max, pow, pi, e.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression to evaluate' },
      },
      required: ['expression'],
    },
    category: 'math' as ToolCategory,
    timeoutMs: 5_000,
    requiresApproval: false,
    hasSideEffects: false,
    zodSchema: calculatorInputSchema,
    handler: async (input: unknown) => {
      const { expression } = input as CalculatorInput;
      const result = evaluateExpression(expression);

      if (!isFinite(result)) {
        throw new Error(`Expression evaluated to a non-finite value: ${result}`);
      }

      return JSON.stringify({ result, expression });
    },
  };
}
