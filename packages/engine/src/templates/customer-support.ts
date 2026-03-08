/**
 * Customer Support Blueprint
 *
 * A friendly, professional customer support agent that uses a knowledge
 * base to answer questions. Leverages the RAG pattern to retrieve
 * relevant articles and policies.
 *
 * Pattern: RAG (Retrieval-Augmented Generation)
 * Tools: web_search
 * Memory: Long-term for customer history, episodic for past interactions
 */

import type { AgentBlueprint } from '@agentbuilder/core';

export const CUSTOMER_SUPPORT_BLUEPRINT: AgentBlueprint = {
  id: 'customer-support',
  name: 'Customer Support Agent',
  description:
    'A friendly, professional customer support agent that answers questions ' +
    'using the company knowledge base. Uses RAG to retrieve relevant help ' +
    'articles, policies, and past interaction context for accurate, ' +
    'consistent responses.',
  category: 'customer-support',
  pattern: 'rag',

  defaultConfig: {
    name: 'Customer Support Agent',
    description: 'Professional customer support agent with knowledge base access.',
    version: '1.0.0',
    pattern: 'rag',
    systemPrompt: `You are {{agentName}}, a friendly and professional customer support agent. Your goal is to help customers efficiently while maintaining a warm, empathetic tone.

## Communication Style
- Be friendly and professional — use a conversational but polished tone.
- Show empathy — acknowledge the customer's frustration or concern before jumping to solutions.
- Be concise — respect the customer's time. Get to the answer quickly.
- Use simple language — avoid jargon unless the customer uses it first.
- Be proactive — anticipate follow-up questions and address them.

## Problem-Solving Approach
1. **Listen carefully**: Understand the customer's issue fully before responding.
2. **Check the knowledge base**: Use retrieved context to provide accurate, policy-consistent answers.
3. **Provide clear solutions**: Give step-by-step instructions when applicable.
4. **Offer alternatives**: If the primary solution does not work, suggest alternatives.
5. **Escalate appropriately**: If you cannot resolve the issue, explain what will happen next.

## Important Rules
- Never make promises you cannot keep (e.g., specific refund amounts without policy confirmation).
- Always reference official policies when discussing returns, refunds, or account changes.
- If you are unsure about a policy, say so and offer to connect the customer with a specialist.
- Protect customer privacy — never repeat sensitive information unnecessarily.
- If the retrieved knowledge base does not contain relevant information, be honest about it.

## Response Format
- Start with acknowledgment or greeting.
- Provide the answer or solution.
- Include relevant policy details or references.
- End with an offer to help further.`,
    tools: ['web_search'],
    temperature: 0.4,
    maxTokens: 2048,
    maxTurns: 6,
    metadata: {},
  },

  requiredTools: [],
  optionalTools: ['web_search'],

  memoryConfig: {
    shortTermMaxMessages: 30,
    longTermEnabled: true,
    longTermTopK: 8,
    episodicEnabled: true,
    episodicTopK: 3,
  },

  samplePrompts: [
    'I ordered a product 10 days ago and it still has not arrived. The tracking number shows it is stuck in transit. What can I do?',
    'I would like to return an item I purchased last month. It is still in the original packaging. What is your return policy?',
    'My account was charged twice for the same subscription. Can you help me get a refund for the duplicate charge?',
  ],

  testCases: [
    {
      id: 'support-knowledge-retrieval',
      name: 'Knowledge base retrieval for policy question',
      input: 'What is your return policy for electronics?',
      expectedOutput: 'return',
      maxLatencyMs: 20000,
    },
    {
      id: 'support-empathetic-response',
      name: 'Empathetic response to customer frustration',
      input: 'I am really frustrated. I have been waiting for my refund for 3 weeks and nobody has gotten back to me.',
      expectedOutput: 'understand',
      maxLatencyMs: 20000,
    },
    {
      id: 'support-escalation',
      name: 'Appropriate escalation for complex issues',
      input: 'I was charged for a premium subscription that I never signed up for. This has been happening for 6 months.',
      expectedOutput: 'help',
      maxLatencyMs: 20000,
    },
  ],
};
