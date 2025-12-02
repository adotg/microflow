import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Map-Reduce Pattern: Parallel Processing with Aggregation
 *
 * The map-reduce pattern suits scenarios with either large input data (e.g., multiple
 * files to process) or large output data (e.g., multiple forms to fill). Tasks decompose
 * into independent parts that can be processed in parallel, then aggregated.
 *
 * **How it works:**
 * 1. **Map Phase**: The prep generator yields multiple items (e.g., documents). Each
 *    item is passed to exec independently. MicroFlow's runtime automatically executes
 *    all exec calls in parallel for maximum throughput.
 *
 * 2. **Reduce Phase**: The post method receives all results and performs aggregation.
 *    For complex reduction, post can transition to another node that handles the
 *    final combination step.
 *
 * **Key advantages:**
 * - Automatic parallelization: All exec calls run concurrently without additional code
 * - Clean separation: Map logic in one node, reduce logic in another
 * - Efficient for I/O-bound LLM operations where parallel execution dramatically
 *   reduces total wall-clock time
 *
 * **Implementation:**
 * - Map node yields multiple items in prep (one per document/task)
 * - Each exec processes its item independently (can be LLM call, embedding, etc.)
 * - Post collects results and either aggregates locally or transitions to reduce node
 * - Reduce node synthesizes the final output from all mapped results
 */

interface MapReduceStore {
  documents: string[];
  summaries?: string[];
  finalSummary?: string;
}

class MapNode extends Node<MapReduceStore, string, string> {
  async *prep(store: MapReduceStore) {
    for (const doc of store.documents) {
      yield doc;
    }
  }

  async exec(store: MapReduceStore, doc: string): Promise<string> {
    return mockLLM.call(`Summarize: ${doc}`);
  }

  async post(
    store: MapReduceStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.summaries = execResults;
    return 'reduce';
  }
}

class ReduceNode extends Node<MapReduceStore, string, string> {
  async *prep(store: MapReduceStore) {
    const allSummaries = store.summaries!.join('\n---\n');
    yield `Combine these summaries into one: ${allSummaries}`;
  }

  async exec(store: MapReduceStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: MapReduceStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.finalSummary = execResults[0];
    return null;
  }
}

describe('Map-Reduce Pattern', () => {
  test('processes multiple items in parallel then aggregates', async () => {
    const store: MapReduceStore = {
      documents: [
        'Document 1: Introduction to AI...',
        'Document 2: Machine Learning basics...',
        'Document 3: Deep Learning advances...'
      ]
    };

    const mapNode = new MapNode();
    const reduceNode = new ReduceNode();

    mapNode.connect('reduce', reduceNode);

    await run(mapNode, store);

    expect(store.summaries).toHaveLength(3);
    expect(store.finalSummary).toBeDefined();
  });
});
