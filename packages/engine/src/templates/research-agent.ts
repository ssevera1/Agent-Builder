/**
 * Research Agent Blueprint
 *
 * An expert researcher that searches for information, cross-references
 * sources, and provides comprehensive answers with citations.
 *
 * Pattern: ReAct (Reasoning + Acting)
 * Tools: web_search, http_request
 * Memory: Long-term enabled for research history
 */

import type { AgentBlueprint } from '@agentbuilder/core';

export const RESEARCH_AGENT_BLUEPRINT: AgentBlueprint = {
  id: 'research-agent',
  name: 'Research Agent',
  description:
    'An expert researcher that searches for information, cross-references ' +
    'multiple sources, evaluates credibility, and provides comprehensive, ' +
    'well-cited answers. Uses a ReAct loop to iteratively search, analyze, ' +
    'and synthesize findings.',
  category: 'research',
  pattern: 'react',

  defaultConfig: {
    name: 'Research Agent',
    description: 'Expert researcher with web search and analysis capabilities.',
    version: '1.0.0',
    pattern: 'react',
    systemPrompt: `You are an expert research assistant named {{agentName}}. Your purpose is to help users find accurate, comprehensive information on any topic.

## Your Approach
1. **Understand the question**: Break down what the user is asking and identify the key information needs.
2. **Search strategically**: Use web_search to find relevant information. Try multiple search queries with different phrasings to ensure comprehensive coverage.
3. **Cross-reference sources**: Compare information across multiple sources to verify accuracy. Note any conflicting information.
4. **Synthesize findings**: Combine the information into a clear, well-structured response.
5. **Cite your sources**: Always indicate where information came from.

## Research Principles
- Prefer authoritative, primary sources over secondary sources.
- Acknowledge uncertainty when information is conflicting or limited.
- Distinguish between facts, widely-accepted claims, and opinions.
- Present multiple perspectives when the topic is debated.
- Provide context that helps the user understand the significance of findings.

## Response Format
- Start with a concise summary (2-3 sentences).
- Follow with detailed findings organized by subtopic.
- Include source references throughout.
- End with any caveats or areas where more research might be needed.`,
    tools: ['web_search', 'http_request'],
    temperature: 0.3,
    maxTokens: 4096,
    maxTurns: 8,
    metadata: {},
  },

  requiredTools: ['web_search'],
  optionalTools: ['http_request'],

  memoryConfig: {
    shortTermMaxMessages: 20,
    longTermEnabled: true,
    longTermTopK: 5,
    episodicEnabled: true,
    episodicTopK: 3,
  },

  samplePrompts: [
    'What are the latest developments in quantum computing, and which companies are leading the field?',
    'Compare the economic policies of the G7 nations regarding climate change mitigation.',
    'What is the current scientific consensus on the health effects of intermittent fasting? Include citations from peer-reviewed studies.',
  ],

  testCases: [
    {
      id: 'research-basic-search',
      name: 'Basic research query triggers web search',
      input: 'What is the current population of Tokyo?',
      expectedToolCalls: ['web_search'],
      maxLatencyMs: 30000,
    },
    {
      id: 'research-multi-source',
      name: 'Complex question triggers multiple searches',
      input: 'Compare the GDP growth rates of China and India over the last 5 years.',
      expectedToolCalls: ['web_search'],
      maxLatencyMs: 60000,
    },
    {
      id: 'research-synthesis',
      name: 'Research produces cited synthesis',
      input: 'What are the main arguments for and against universal basic income?',
      expectedOutput: 'argument',
      maxLatencyMs: 60000,
    },
  ],
};
