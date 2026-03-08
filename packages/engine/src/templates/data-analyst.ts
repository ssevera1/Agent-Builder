/**
 * Data Analyst Blueprint
 *
 * A data analysis expert that processes data, performs calculations,
 * and generates insights. Uses the Tool-Augmented pattern for
 * straightforward tool-use scenarios.
 *
 * Pattern: Tool-Augmented
 * Tools: calculator, code_executor, http_request
 * Memory: Short-term only (conversation context)
 */

import type { AgentBlueprint } from '@agentbuilder/core';

export const DATA_ANALYST_BLUEPRINT: AgentBlueprint = {
  id: 'data-analyst',
  name: 'Data Analyst',
  description:
    'A data analysis expert that processes datasets, performs calculations, ' +
    'creates statistical analyses, and generates actionable insights. ' +
    'Uses tools directly for computation-heavy tasks.',
  category: 'data',
  pattern: 'tool-augmented',

  defaultConfig: {
    name: 'Data Analyst',
    description: 'Expert data analyst with calculation and code execution capabilities.',
    version: '1.0.0',
    pattern: 'tool-augmented',
    systemPrompt: `You are an expert data analyst named {{agentName}}. You help users analyze data, perform calculations, and derive actionable insights.

## Your Approach
1. **Understand the data**: Ask about the data source, format, and what the user wants to learn from it.
2. **Explore and profile**: Examine the data structure, identify patterns, outliers, and data quality issues.
3. **Analyze rigorously**: Use appropriate statistical methods. Perform calculations using the calculator or code_executor tools.
4. **Visualize when helpful**: Describe charts or graphs that would help communicate findings (generate code to create them when possible).
5. **Communicate clearly**: Present findings in plain language with supporting numbers.

## Analysis Principles
- Always validate data quality before drawing conclusions.
- Use appropriate statistical tests — do not overfit or cherry-pick results.
- Distinguish between correlation and causation.
- Report confidence levels and margins of error when applicable.
- Consider sample size and potential biases.
- Present results honestly, including limitations.

## Available Capabilities
- **calculator**: For precise mathematical operations (arithmetic, statistics, financial calculations).
- **code_executor**: For running Python/R scripts for complex data processing, statistical analysis, and visualization.
- **http_request**: For fetching data from APIs or URLs.

## Response Format
- Start with a summary of key findings (the "so what").
- Present detailed analysis with supporting calculations.
- Use tables for comparative data.
- Highlight actionable recommendations.
- Note any caveats or data limitations.`,
    tools: ['calculator', 'code_executor', 'http_request'],
    temperature: 0.2,
    maxTokens: 4096,
    maxTurns: 8,
    metadata: {},
  },

  requiredTools: ['calculator'],
  optionalTools: ['code_executor', 'http_request'],

  memoryConfig: {
    shortTermMaxMessages: 20,
    longTermEnabled: false,
    longTermTopK: 0,
    episodicEnabled: false,
    episodicTopK: 0,
  },

  samplePrompts: [
    'Calculate the compound annual growth rate (CAGR) if an investment grew from $10,000 to $25,000 over 7 years.',
    'I have monthly sales data for 12 months: [45000, 52000, 48000, 61000, 55000, 72000, 68000, 75000, 82000, 79000, 91000, 98000]. Analyze the trend, calculate key statistics, and forecast the next 3 months.',
    'Compare the performance of two marketing campaigns: Campaign A had 10,000 impressions with 250 clicks and 15 conversions. Campaign B had 8,000 impressions with 320 clicks and 22 conversions. Which performed better?',
  ],

  testCases: [
    {
      id: 'data-basic-calc',
      name: 'Basic calculation using calculator tool',
      input: 'What is the standard deviation of these numbers: 12, 15, 18, 22, 25, 28, 30?',
      expectedToolCalls: ['calculator'],
      maxLatencyMs: 20000,
    },
    {
      id: 'data-analysis',
      name: 'Statistical analysis with code execution',
      input: 'Run a linear regression on this data: x=[1,2,3,4,5,6,7,8,9,10], y=[2.1, 4.0, 5.9, 8.1, 9.8, 12.0, 14.1, 15.9, 18.0, 20.1]. What is the equation and R-squared?',
      expectedToolCalls: ['code_executor'],
      maxLatencyMs: 45000,
    },
    {
      id: 'data-insights',
      name: 'Generate insights from data',
      input: 'Our quarterly revenue for 2024 was Q1: $1.2M, Q2: $1.5M, Q3: $1.1M, Q4: $1.8M. Analyze the performance and identify concerns.',
      expectedOutput: 'quarter',
      maxLatencyMs: 30000,
    },
  ],
};
