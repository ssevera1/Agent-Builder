/**
 * Web Search tool — search the web using a configurable search backend.
 *
 * Default backend: DuckDuckGo HTML search (no API key required).
 * Results are parsed from the HTML response into a structured format.
 */

import { z } from 'zod';
import type { ToolCategory } from '@agentbuilder/core';
import type { RegisteredTool } from '../registry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const webSearchInputSchema = z.object({
  query: z.string().min(1).describe('The search query'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of results to return (default: 5)'),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

// ---------------------------------------------------------------------------
// Search result type
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Search provider interface
// ---------------------------------------------------------------------------

export interface SearchProvider {
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML search provider
// ---------------------------------------------------------------------------

export class DuckDuckGoProvider implements SearchProvider {
  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AgentBuilder/1.0; +https://agentbuilder.dev)',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed with status ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  /**
   * Parse search results from DuckDuckGo's HTML response.
   * The HTML contains result blocks with class "result" and anchors
   * with class "result__a" for the link, and "result__snippet" for text.
   */
  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Match result blocks. DuckDuckGo HTML uses <a class="result__a"> for
    // titles/links and <a class="result__snippet"> for snippets.
    const resultBlockRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
      const [, rawUrl, rawTitle, rawSnippet] = match;
      if (!rawUrl || !rawTitle) continue;

      // Decode DuckDuckGo redirect URL.
      let decodedUrl = rawUrl;
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch?.[1]) {
        decodedUrl = decodeURIComponent(uddgMatch[1]);
      }

      const title = stripHtml(rawTitle).trim();
      const snippet = stripHtml(rawSnippet ?? '').trim();

      if (title && decodedUrl) {
        results.push({ title, url: decodedUrl, snippet });
      }
    }

    // Fallback: try a simpler pattern if the above yields nothing.
    if (results.length === 0) {
      const simpleLinkRegex =
        /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

      while (
        (match = simpleLinkRegex.exec(html)) !== null &&
        results.length < maxResults
      ) {
        const [, rawUrl, rawTitle] = match;
        if (!rawUrl || !rawTitle) continue;

        let decodedUrl = rawUrl;
        const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch?.[1]) {
          decodedUrl = decodeURIComponent(uddgMatch[1]);
        }

        const title = stripHtml(rawTitle).trim();
        if (title && decodedUrl) {
          results.push({ title, url: decodedUrl, snippet: '' });
        }
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WebSearchToolOptions {
  /** Custom search provider (default: DuckDuckGoProvider). */
  provider?: SearchProvider;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createWebSearchTool(options?: WebSearchToolOptions): RegisteredTool {
  const provider = options?.provider ?? new DuckDuckGoProvider();

  return {
    name: 'web_search',
    description:
      'Search the web for information. Returns a list of results with titles, URLs, and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
    category: 'search' as ToolCategory,
    timeoutMs: 15_000,
    requiresApproval: false,
    hasSideEffects: false,
    zodSchema: webSearchInputSchema,
    handler: async (input: unknown, signal?: AbortSignal) => {
      const { query, maxResults } = input as WebSearchInput;
      const searchResults = await provider.search(query, maxResults, signal);
      return JSON.stringify({ results: searchResults, query });
    },
  };
}
