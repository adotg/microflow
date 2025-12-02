import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Retry & Fallback: Resilient Error Handling
 *
 * MicroFlow provides built-in retry and fallback mechanisms to handle transient
 * failures in LLM APIs, network issues, or validation errors.
 *
 * **How it works:**
 * 1. **Automatic Retries**: When exec() throws an error, MicroFlow automatically
 *    retries up to `maxRetries` times (configurable via NodeConfig). There's a
 *    configurable `retryDelay` between attempts.
 *
 * 2. **Exponential Backoff**: While not shown in this example, you can implement
 *    exponential backoff by using the retry count in custom error handling.
 *
 * 3. **Fallback Mechanism**: If all retries are exhausted, the optional execFallback()
 *    method is called. This allows graceful degradation:
 *    - Return a default/cached value
 *    - Use a simpler model
 *    - Return a user-friendly error message
 *    - Log the error and continue execution
 *
 * **Configuration:**
 * Pass NodeConfig to the constructor:
 * - `maxRetries`: Number of retry attempts (default: 3)
 * - `retryDelay`: Milliseconds between retries (default: 2000)
 * - `timeout`: Maximum execution time in ms (default: 60000)
 *
 * **When to use:**
 * - LLM API rate limits or transient errors
 * - Network instability
 * - Validation failures that might succeed on retry
 * - Any scenario where temporary failures are expected
 *
 * **Implementation:**
 * Throw errors in exec() to trigger retry. Implement execFallback() for graceful
 * degradation when retries are exhausted. The retry logic is handled automatically
 * by the runtime.
 */

interface RetryStore {
  prompt: string;
  result?: string;
  attempts: number;
}

class UnreliableNode extends Node<RetryStore, string, string> {
  async *prep(store: RetryStore) {
    yield store.prompt;
  }

  async exec(store: RetryStore, prompt: string): Promise<string> {
    store.attempts++;

    if (store.attempts < 3) {
      throw new Error('Simulated API failure');
    }

    return mockLLM.call(prompt);
  }

  async post(
    store: RetryStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.result = execResults[0];
    return null;
  }

  execFallback(store: RetryStore, item: string, error: Error): Promise<string> {
    return Promise.resolve('Fallback response due to error');
  }
}

describe('Retry and Fallback', () => {
  test('retries failed executions', async () => {
    const store: RetryStore = {
      prompt: 'Test prompt',
      attempts: 0
    };

    const node = new UnreliableNode({ maxRetries: 3, retryDelay: 10 });
    await run(node, store);

    expect(store.attempts).toBe(3);
    expect(store.result).toBeDefined();
  });

  test('uses fallback when retries exhausted', async () => {
    const store: RetryStore = {
      prompt: 'Test prompt',
      attempts: 0
    };

    const node = new UnreliableNode({ maxRetries: 2, retryDelay: 10 });
    await run(node, store);

    expect(store.attempts).toBe(2);
    expect(store.result).toBe('Fallback response due to error');
  });
});
