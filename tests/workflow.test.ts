import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Workflow Pattern: Sequential Task Decomposition
 *
 * Workflows address complex tasks through task decomposition - breaking them into
 * a chain of multiple interconnected nodes that execute sequentially. Each node
 * handles a specific subtask and passes results to the next node via the shared store.
 *
 * **How it works:**
 * - Each node's `post()` returns an action string that identifies the next node
 * - Nodes are connected via `connect(action, targetNode)` to build the graph
 * - The runtime follows the action path, executing nodes in sequence
 * - State flows through the shared store, allowing each node to access prior results
 *
 * **When to use:**
 * - Tasks too complex for a single LLM call
 * - Predetermined, linear execution paths
 * - Need to maintain context across multiple processing steps
 *
 * **Trade-offs:**
 * - Tasks shouldn't be too broad (exceeds single LLM capabilities)
 * - Tasks shouldn't be too fine-grained (context loss between nodes)
 * - For dynamic routing based on content, consider the Agent pattern instead
 */

interface WorkflowStore {
  userQuery: string;
  researchResults?: string;
  outline?: string;
  finalReport?: string;
}

class ResearchNode extends Node<WorkflowStore, string, string> {
  async *prep(store: WorkflowStore) {
    yield `Research the following topic: ${store.userQuery}`;
  }

  async exec(store: WorkflowStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: WorkflowStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.researchResults = execResults[0];
    return 'outline';
  }
}

class OutlineNode extends Node<WorkflowStore, string, string> {
  async *prep(store: WorkflowStore) {
    yield `Create an outline based on: ${store.researchResults}`;
  }

  async exec(store: WorkflowStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: WorkflowStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.outline = execResults[0];
    return 'write';
  }
}

class WriterNode extends Node<WorkflowStore, string, string> {
  async *prep(store: WorkflowStore) {
    yield `Write a report following this outline: ${store.outline}`;
  }

  async exec(store: WorkflowStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: WorkflowStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.finalReport = execResults[0];
    return null;
  }
}

describe('Workflow Pattern', () => {
  test('chains multiple nodes in sequential workflow', async () => {
    const store: WorkflowStore = {
      userQuery: 'History of quantum computing'
    };

    const researchNode = new ResearchNode();
    const outlineNode = new OutlineNode();
    const writerNode = new WriterNode();

    researchNode.connect('outline', outlineNode);
    outlineNode.connect('write', writerNode);

    await run(researchNode, store);

    expect(store.researchResults).toBeDefined();
    expect(store.outline).toBeDefined();
    expect(store.finalReport).toBeDefined();
  });
});
