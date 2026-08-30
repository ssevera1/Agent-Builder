import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, estimateTokens, fitsInContext, TokenCountError } from './token-counter.js';

describe('estimateTokens', () => {
  it('throws TokenCountError for null or undefined text', () => {
    expect(() => estimateTokens(null as unknown as string)).toThrow(TokenCountError);
    expect(() => estimateTokens(undefined as unknown as string)).toThrow(TokenCountError);
  });

  it('throws TokenCountError when model is not a string', () => {
    // Regression: getRatio() used to call model.toLowerCase() unguarded,
    // so a non-string model raised a raw TypeError instead of TokenCountError.
    expect(() => estimateTokens('hi', 42 as unknown as string)).toThrow(TokenCountError);
  });

  it('estimates tokens for valid text', () => {
    expect(estimateTokens('Hello, world!')).toBeGreaterThan(0);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('estimateMessagesTokens', () => {
  it('throws TokenCountError for null or undefined messages', () => {
    expect(() => estimateMessagesTokens(null as unknown as [])).toThrow(TokenCountError);
    expect(() => estimateMessagesTokens(undefined as unknown as [])).toThrow(TokenCountError);
  });
});

describe('fitsInContext', () => {
  it('throws TokenCountError for null or undefined contextWindow/reserveForOutput', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    expect(() => fitsInContext(messages, null as unknown as number)).toThrow(TokenCountError);
    expect(() =>
      fitsInContext(messages, 1000, null as unknown as number),
    ).toThrow(TokenCountError);
  });
});
