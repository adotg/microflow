import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Multi-Agent Pattern: Coordinated Collaboration
 *
 * Multiple agents work together by handling subtasks and communicating progress.
 * Agents coordinate through shared state (message queues, context) to solve
 * complex problems requiring different specializations or perspectives.
 *
 * **How it works:**
 * 1. **Message Queue Communication**: Agents pass messages through arrays in the
 *    shared store. Each agent reads recent messages, processes them, and appends
 *    its output back to the queue.
 *
 * 2. **Shared State**: All agents access common data through the store, containing
 *    message history, current state, and coordination metadata (e.g., round counter).
 *
 * 3. **Turn-Based or Concurrent**: Agents can take turns (action transitions between
 *    agents) or run concurrently (multiple run() calls in parallel). This example
 *    shows turn-based coordination.
 *
 * 4. **Loop Control**: One agent's post() returns an action pointing to another agent,
 *    creating a collaboration loop. The loop continues until a terminal condition
 *    (success, max rounds, etc.) is reached.
 *
 * **When to use:**
 * - Tasks requiring multiple specialized agents (e.g., researcher + writer)
 * - Adversarial or debate scenarios (e.g., proposer + critic)
 * - Cooperative problem-solving (e.g., game-playing agents)
 * - Complex workflows where different LLMs or prompts handle different aspects
 *
 * **Important caveat:**
 * Most of the time, you don't need multi-agents. Start with a simple solution first.
 * Multi-agent systems add complexity and are only justified when the problem truly
 * requires multiple independent decision-makers.
 *
 * **Implementation:**
 * Each agent is a node. They connect to each other forming a loop. Messages array
 * in store acts as communication channel. Round counter or success flag controls
 * when to exit the loop by returning null instead of the next agent's action.
 */

interface MultiAgentStore {
  messages: Array<{ from: string; content: string }>;
  targetWord?: string;
  guessed?: boolean;
  rounds: number;
}

class HinterNode extends Node<MultiAgentStore, string, string> {
  async *prep(store: MultiAgentStore) {
    const history = store.messages.slice(-3).map(m => `${m.from}: ${m.content}`).join('\n');
    yield `Target word: ${store.targetWord}
Previous messages: ${history}
Give a one-word clue (don't say the target word).`;
  }

  async exec(store: MultiAgentStore, prompt: string): Promise<string> {
    await mockLLM.call(prompt);
    return 'related-clue';
  }

  async post(
    store: MultiAgentStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    const clue = execResults[0];
    store.messages.push({ from: 'Hinter', content: clue });
    return 'guesser';
  }
}

class GuesserNode extends Node<MultiAgentStore, string, string> {
  async *prep(store: MultiAgentStore) {
    const history = store.messages.map(m => `${m.from}: ${m.content}`).join('\n');
    yield `Messages: ${history}\nGuess the target word (one word):`;
  }

  async exec(store: MultiAgentStore, prompt: string): Promise<string> {
    await mockLLM.call(prompt);

    if (store.rounds >= 2) {
      return store.targetWord!;
    }
    return 'wrong-guess';
  }

  async post(
    store: MultiAgentStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    const guess = execResults[0];
    store.messages.push({ from: 'Guesser', content: guess });
    store.rounds++;

    if (guess === store.targetWord) {
      store.guessed = true;
      return null;
    }

    if (store.rounds >= 3) {
      return null;
    }

    return 'hinter';
  }
}

describe('Multi-Agent Pattern', () => {
  test('two agents coordinate via shared message queue', async () => {
    const store: MultiAgentStore = {
      messages: [],
      targetWord: 'computer',
      guessed: false,
      rounds: 0
    };

    const hinterNode = new HinterNode();
    const guesserNode = new GuesserNode();

    hinterNode.connect('guesser', guesserNode);
    guesserNode.connect('hinter', hinterNode);

    await run(hinterNode, store);

    expect(store.messages.length).toBeGreaterThan(0);
    expect(store.rounds).toBeGreaterThan(0);
    expect(store.guessed).toBe(true);
  });
});
