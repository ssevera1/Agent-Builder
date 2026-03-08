/**
 * HTTP Request tool — make outbound HTTP requests using native `fetch`.
 *
 * Security: blocks requests to private / reserved IP ranges by default
 * (IPv4 RFC 1918, link-local, loopback, etc.).
 */

import { z } from 'zod';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const httpRequestInputSchema = z.object({
  url: z.string().url().describe('The URL to send the request to'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    .optional()
    .default('GET')
    .describe('HTTP method'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Request headers as key-value pairs'),
  body: z.string().optional().describe('Request body (for POST / PUT / PATCH)'),
});

export type HttpRequestInput = z.infer<typeof httpRequestInputSchema>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface HttpRequestToolOptions {
  /** Whether to block requests to private IP ranges (default: true). */
  blockPrivateIPs?: boolean;
  /** Maximum response body size to return in characters (default: 10 000). */
  maxResponseChars?: number;
  /** Optional base headers included in every request. */
  baseHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Private IP detection
// ---------------------------------------------------------------------------

/**
 * Check whether a hostname resolves (or literally is) a private / reserved IP.
 * This is a best-effort check based on the hostname string itself. A DNS
 * lookup-based check would be more thorough but also more complex.
 */
function isPrivateHost(hostname: string): boolean {
  // Localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return true;
  }

  // IPv4 private ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number) as [number, number, number, number, number];
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16.0.0 – 172.31.255.255
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true;
    // 0.x.x.x
    if (a === 0) return true;
    // 100.64–127.x.x (carrier-grade NAT)
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    // 198.18–19.x.x (benchmark testing)
    if (a === 198 && (b === 18 || b === 19)) return true;
  }

  // Metadata endpoints (AWS, GCP, Azure)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createHttpRequestTool(options?: HttpRequestToolOptions): RegisteredTool {
  const blockPrivate = options?.blockPrivateIPs ?? true;
  const maxChars = options?.maxResponseChars ?? 10_000;
  const baseHeaders = options?.baseHeaders ?? {};

  return {
    name: 'http_request',
    description:
      'Make an HTTP request to a URL. Returns the status code, response headers, and body (truncated to 10 000 characters). Blocks requests to private IP ranges by default.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to send the request to' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
          description: 'HTTP method',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Request headers',
        },
        body: { type: 'string', description: 'Request body' },
      },
      required: ['url'],
    },
    category: 'web' as ToolCategory,
    timeoutMs: 30_000,
    requiresApproval: false,
    hasSideEffects: true,
    zodSchema: httpRequestInputSchema,
    handler: async (input: unknown, signal?: AbortSignal) => {
      const { url, method, headers, body } = input as HttpRequestInput;

      // Parse URL and check for private IPs.
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error(`Invalid URL: "${url}"`);
      }

      if (blockPrivate && isPrivateHost(parsedUrl.hostname)) {
        throw new Error(
          `Request blocked: "${parsedUrl.hostname}" appears to be a private or reserved address.`,
        );
      }

      // Only allow http and https.
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Unsupported protocol: "${parsedUrl.protocol}". Only http and https are allowed.`);
      }

      const mergedHeaders: Record<string, string> = {
        ...baseHeaders,
        ...headers,
      };

      const response = await fetch(url, {
        method: method ?? 'GET',
        headers: mergedHeaders,
        body: body ?? undefined,
        signal,
        redirect: 'follow',
      });

      const responseBody = await response.text();
      const truncatedBody =
        responseBody.length > maxChars
          ? responseBody.slice(0, maxChars) + `\n...[truncated, ${responseBody.length} total chars]`
          : responseBody;

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: truncatedBody,
      });
    },
  };
}
