import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Node Configuration: Parameters & Settings
 *
 * MicroFlow nodes support two types of configuration:
 *
 * **1. NodeConfig (Constructor):**
 * Reliability and execution settings passed to the constructor:
 * - `maxRetries`: Number of retry attempts on failure (default: 3)
 * - `retryDelay`: Milliseconds between retries (default: 2000)
 * - `timeout`: Maximum execution time in milliseconds (default: 60000)
 *
 * These settings control the runtime behavior and error handling for the node.
 *
 * **2. Custom Parameters (setParams):**
 * Application-specific configuration set via setParams() and accessed through
 * this.params in node methods. Useful for:
 * - Prompt templates or prefixes
 * - Model selection (e.g., gpt-4 vs gpt-3.5)
 * - Temperature, max tokens, or other LLM parameters
 * - Feature flags or conditional behavior
 *
 * **How it works:**
 * - Pass NodeConfig object to super() in constructor for runtime settings
 * - Chain setParams() call when instantiating node for custom configuration
 * - Access this.params in prep/exec/post methods
 * - Params are strongly typed via the Params type (Record<string, any>)
 *
 * **Method chaining:**
 * Both connect() and setParams() return `this`, enabling fluent API:
 * ```typescript
 * const node = new MyNode({ maxRetries: 5 })
 *   .setParams({ temperature: 0.7 })
 *   .connect('next', nextNode);
 * ```
 *
 * **When to use:**
 * - NodeConfig: When you need different reliability guarantees per node
 * - setParams: When nodes need different behavior but share the same class
 *
 * This pattern enables node reusability while maintaining flexibility.
 */

interface ConfigStore {
  input: string;
  output?: string;
}

class ConfigurableNode extends Node<ConfigStore, string, string> {
  async *prep(store: ConfigStore) {
    const prefix = this.params.prefix || '';
    yield `${prefix}${store.input}`;
  }

  async exec(store: ConfigStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: ConfigStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.output = execResults[0];
    return null;
  }
}

describe('Node Configuration', () => {
  test('nodes can be configured with custom parameters', async () => {
    const store: ConfigStore = {
      input: 'Hello'
    };

    const node = new ConfigurableNode()
      .setParams({ prefix: 'Say: ' });

    await run(node, store);

    expect(store.output).toBeDefined();
  });

  test('nodes can be configured with retry settings', async () => {
    const store: ConfigStore = {
      input: 'Test'
    };

    const node = new ConfigurableNode({
      maxRetries: 5,
      retryDelay: 100,
      timeout: 30000
    });

    expect(node.config.maxRetries).toBe(5);
    expect(node.config.retryDelay).toBe(100);
    expect(node.config.timeout).toBe(30000);
  });

  test('configuration supports method chaining', async () => {
    const store: ConfigStore = {
      input: 'Test'
    };

    const nextNode = new ConfigurableNode();

    const node = new ConfigurableNode({ maxRetries: 2 })
      .setParams({ prefix: 'Prompt: ' })
      .connect('next', nextNode);

    expect(node.config.maxRetries).toBe(2);
    expect(node.getEdge('next')).toBe(nextNode);
  });
});
