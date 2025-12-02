import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Parallel Execution: Automatic Concurrency
 *
 * MicroFlow automatically executes all prep items in parallel for maximum throughput.
 * This is a core architectural feature that makes LLM workflows efficient without
 * requiring explicit concurrency management.
 *
 * **How it works:**
 * 1. **Generator Pattern**: The prep() generator yields multiple items. As soon as
 *    an item is yielded, it's immediately dispatched to exec() without waiting for
 *    previous items to complete.
 *
 * 2. **Concurrent Execution**: All exec() calls run concurrently via Promise.all().
 *    This is crucial for I/O-bound LLM operations where wall-clock time is dominated
 *    by network latency, not CPU.
 *
 * 3. **Order Preservation**: Despite parallel execution, results maintain the same
 *    order as prep items. post() receives prepItems and execResults in corresponding
 *    order, making aggregation predictable.
 *
 * 4. **Automatic Batching**: If you yield 100 items, all 100 exec() calls run
 *    concurrently (subject to runtime limits). No manual batching or pooling needed.
 *
 * **Performance impact:**
 * For N items with exec time T:
 * - Sequential: N × T total time
 * - Parallel (MicroFlow): ~T total time (assuming sufficient resources)
 *
 * Example: 10 LLM calls at 500ms each
 * - Sequential: 5000ms
 * - Parallel: ~500ms
 *
 * **When parallel execution shines:**
 * - Map-reduce over large datasets
 * - Batch processing (embeddings, classifications, etc.)
 * - RAG document chunking and embedding
 * - Any scenario with independent, I/O-bound operations
 *
 * **Implementation:**
 * Simply yield multiple items in prep(). The runtime handles the rest. No special
 * syntax or concurrency primitives needed - it's the default behavior.
 */

interface ParallelStore {
  queries: string[];
  results?: string[];
}

class ParallelNode extends Node<ParallelStore, string, string> {
  async *prep(store: ParallelStore) {
    for (const query of store.queries) {
      yield query;
    }
  }

  async exec(store: ParallelStore, query: string): Promise<string> {
    return mockLLM.call(query, 10);
  }

  async post(
    store: ParallelStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.results = execResults;
    return null;
  }
}

describe('Parallel Execution', () => {
  test('executes multiple prep items in parallel', async () => {
    const store: ParallelStore = {
      queries: ['Query 1', 'Query 2', 'Query 3', 'Query 4', 'Query 5']
    };

    const node = new ParallelNode();
    const startTime = Date.now();

    await run(node, store);

    const elapsed = Date.now() - startTime;

    expect(store.results).toHaveLength(5);
    expect(elapsed).toBeLessThan(40);
  });
});
