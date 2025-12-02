import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Single Node Execution
 *
 * The fundamental building block of MicroFlow is the three-phase node:
 *
 * 1. **prep**: Generator function that yields items to be processed. Can yield
 *    synchronous values or Promises. Each yielded item will be passed to exec.
 *
 * 2. **exec**: Async function that processes each item from prep. This is where
 *    expensive operations like LLM calls happen. All exec calls run in parallel
 *    automatically for maximum throughput.
 *
 * 3. **post**: Receives all prep items and exec results after everything completes.
 *    Used for aggregation, storing results, and flow control (returning an action
 *    string to transition to another node, or null to end).
 *
 * This pattern separates data preparation, parallel execution, and result aggregation
 * into distinct phases, making LLM workflows composable and efficient.
 */

interface BasicStore {
  prompt: string;
  result?: string;
}

class SimpleNode extends Node<BasicStore, string, string> {
  async *prep(store: BasicStore) {
    yield store.prompt;
  }

  async exec(store: BasicStore, item: string): Promise<string> {
    return mockLLM.call(item);
  }

  async post(
    store: BasicStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.result = execResults[0];
    return null;
  }
}

describe('Single Node Execution', () => {
  test('executes prep-exec-post phases', async () => {
    const store: BasicStore = {
      prompt: 'What is the capital of France?'
    };

    const node = new SimpleNode();
    await run(node, store);

    expect(store.result).toBeDefined();
    expect(store.result).toContain('Response to:');
  });
});
