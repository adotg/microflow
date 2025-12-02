import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Agent Pattern: Dynamic Decision-Making with Loops
 *
 * The agent pattern enables nodes to take dynamic actions based on context. Unlike
 * workflows with predetermined paths, agents use decision-making to determine their
 * next step, enabling adaptive behavior and multi-step reasoning.
 *
 * **How it works:**
 * - A decision node evaluates the current state and selects the next action
 * - Action nodes execute tasks (e.g., search, calculate, retrieve)
 * - Nodes can loop back to the decision node for iterative refinement
 * - The agent continues until reaching a terminal state (e.g., answer ready)
 *
 * **Key principles for high-performance agents:**
 * 1. **Context Management**: Provide relevant, minimal context. Use RAG to retrieve
 *    only pertinent information. LLMs struggle with "lost in the middle" problems
 *    when given too much context.
 *
 * 2. **Action Space Design**: Offer a well-structured, unambiguous set of actions
 *    without overlapping options. Clear choices help the agent make precise decisions.
 *
 * **Implementation:**
 * - Decision node outputs structured data (e.g., YAML/JSON) with action + reasoning
 * - Action nodes connect back to decision node creating a loop
 * - Store tracks iterations and accumulated context
 * - Terminal actions (like 'answer') break the loop by connecting to final nodes
 */

interface AgentStore {
  question: string;
  context: string[];
  answer?: string;
  iterations: number;
}

interface AgentDecision {
  action: 'search' | 'answer';
  reasoning: string;
  query?: string;
}

class DecisionNode extends Node<AgentStore, string, AgentDecision> {
  async *prep(store: AgentStore) {
    const contextStr = store.context.join('\n');
    yield `Question: ${store.question}
Context so far: ${contextStr}
Decide whether to search for more information or answer the question.`;
  }

  async exec(store: AgentStore, prompt: string): Promise<AgentDecision> {
    await mockLLM.call(prompt);

    if (store.context.length < 2) {
      return {
        action: 'search',
        reasoning: 'Need more information',
        query: store.question
      };
    } else {
      return {
        action: 'answer',
        reasoning: 'Have sufficient context'
      };
    }
  }

  async post(
    store: AgentStore,
    prepItems: string[],
    execResults: AgentDecision[]
  ): Promise<Action> {
    const decision = execResults[0];
    return decision.action;
  }
}

class SearchNode extends Node<AgentStore, string, string> {
  async *prep(store: AgentStore) {
    yield store.question;
  }

  async exec(store: AgentStore, query: string): Promise<string> {
    return mockLLM.searchWeb(query);
  }

  async post(
    store: AgentStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.context.push(execResults[0]);
    store.iterations++;
    return 'decide';
  }
}

class AnswerNode extends Node<AgentStore, string, string> {
  async *prep(store: AgentStore) {
    const contextStr = store.context.join('\n');
    yield `Question: ${store.question}\nContext: ${contextStr}\nAnswer:`;
  }

  async exec(store: AgentStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: AgentStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.answer = execResults[0];
    return null;
  }
}

describe('Agent Pattern', () => {
  test('agent makes decisions and loops until ready to answer', async () => {
    const store: AgentStore = {
      question: 'What is the latest news about AI?',
      context: [],
      iterations: 0
    };

    const decisionNode = new DecisionNode();
    const searchNode = new SearchNode();
    const answerNode = new AnswerNode();

    decisionNode
      .connect('search', searchNode)
      .connect('answer', answerNode);

    searchNode.connect('decide', decisionNode);

    await run(decisionNode, store);

    expect(store.iterations).toBeGreaterThan(0);
    expect(store.context.length).toBeGreaterThan(0);
    expect(store.answer).toBeDefined();
  });
});
