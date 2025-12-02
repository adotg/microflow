# MicroFlow - Technical Design Document

## 1. Overview

MicroFlow is a minimalist LLM orchestration library for TypeScript inspired by PocketFlow's elegant design philosophy. It brings the **prep-exec-post** pipeline and **action-based flow control** to the TypeScript ecosystem with a **unified generator-based architecture** and universal runtime support (browser + Node.js).

### Design Principles

- **PocketFlow's Wisdom**: Keep the proven prep-exec-post pattern and action-based transitions
- **Unified Node Type**: Single node abstraction using generators - no separate batch/async nodes
- **Consistent Contracts**: All methods use generators for prep/exec, async for post
- **Node-Centric Graph**: Nodes connect to each other directly (`n1.connect(n2)`)
- **Open-Closed Architecture**: Extend via composition, not modification
- **Universal Runtime**: Works in both browser and Node.js
- **Radical Simplicity**: Target <100 LOC for core

### Key Differentiators from PocketFlow

| Feature | PocketFlow | MicroFlow |
|---------|-----------|-----------|
| Language | Python | TypeScript |
| Node Pipeline | prep-exec-post ✅ | prep-exec-post ✅ |
| Flow Control | Action strings ✅ | Action strings ✅ |
| Node Types | Node, BatchNode, AsyncNode | Single Node with generators |
| prep/exec | Functions | **Async Generators** (always) |
| post | Function | **Async Function** (returns Promise) |
| Batch Processing | Separate BatchNode class | Built-in via generators |
| Streaming | Via AsyncNode | Built-in via generators |
| Node Connection | `n1 >> n2`, `n1 - "action" >> n2` | `n1.connect(n2)`, `n1.connect('action', n2)` |
| Runtime Support | Node.js/Python | Browser + Node.js |

---

## 2. Core Abstractions

### 2.1 Node - The Fundamental Unit

A **Node** is a class with three methods forming the **prep-exec-post** pipeline.

**Important**: Node only *defines* the logic - it doesn't execute itself. Execution is handled by a separate global `run()` function. This separation keeps the Node class focused and allows for flexible execution strategies.

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│    prep     │  →   │    exec     │  →   │    post     │
│ (generator) │      │ (generator) │      │   (async)   │
│  yield items│      │yield results│      │return action│
└─────────────┘      └─────────────┘      └─────────────┘
     ↓                    ↓                     ↓
  Shared             Pure Fn              Shared + Action
```

#### The Three Methods

1. **`async *prep(store)`** - Input processing (async generator)
   - Reads data from shared store
   - Yields items to process (one or many)
   - Can make async I/O calls (API, DB, files)
   - **Always a generator** - even for single items
   - **Can access**: `store`, `this.params`

2. **`async *exec(store, item)`** - Core execution (async generator)
   - **Pure computation** (or as pure as possible)
   - Receives store for reading (should NOT write to store)
   - Called once per item from prep
   - Yields results (can yield multiple per item for streaming)
   - **Automatic retry** on errors
   - **Can read from store** but should avoid writes (prep/post handle I/O)
   - **Always a generator** - consistency

3. **`async post(store, prepItems, execResults)`** - Output processing (async function)
   - Receives arrays of all prep items and exec results
   - Writes results to store
   - Determines next action
   - **Returns**: Promise<Action> - Action string ('default', 'success', 'error', etc.)
   - **Special**: Return `null` to end execution
   - **Not a generator** - just async function

#### Optional Method

4. **`async execFallback(store, item, error)`** - Error handling
   - Called after retries exhausted
   - Receives store for context
   - Return fallback value or re-throw
   - Default: re-throws the error

**Philosophy**:
- **Generators everywhere (prep/exec)**: Enable incremental processing, streaming, and async I/O
- **Consistent contracts**: No special cases, simple mental model
- **Flexible semantics**: Library provides infrastructure, implementer decides what to yield
- **Separation of concerns**: I/O (prep/post) from computation (exec)

### 2.2 Store - Shared Memory

The **Store** is a simple object (like PocketFlow's `shared` dict) accessible to all nodes:

```typescript
const store = {
  // Your data schema
  query: 'What is quantum computing?',
  documents: [],
  embeddings: [],
  response: ''
};
```

- All nodes read/write the same store
- Schema designed upfront
- Simple and predictable
- No complex message passing

### 2.3 Action-Based Flow Control

Nodes connect via **edges** labeled with **actions**:

```typescript
decideNode.connect('search', searchNode);  // If post() returns 'search'
decideNode.connect('answer', answerNode);  // If post() returns 'answer'
searchNode.connect('decide', decideNode);  // Loop back
```

- `post()` returns a string action
- Flow follows the matching edge
- Enables branching, loops, and complex patterns
- Default action: `'default'`

### 2.4 Params - Task Configuration

**Params** are immutable, local configuration set by parent nodes:

```typescript
node.setParams({ filename: 'doc1.txt', id: 123 });
// Inside node methods:
const filename = this.params.filename;
```

- Like function parameters (stack-based)
- Cleared on each parent invocation
- Ideal for tracking context in batch processing

---

## 3. TypeScript Contracts

### 3.1 Core Types

```typescript
/**
 * Shared store - your data schema
 */
export type Store<T = Record<string, any>> = T;

/**
 * Action string returned by post() to control flow
 */
export type Action = string | null;

/**
 * Immutable parameters for task configuration
 */
export type Params = Record<string, any>;

/**
 * Node configuration
 */
export interface NodeConfig {
  /** Maximum retries for exec() */
  maxRetries?: number;

  /** Wait time between retries (ms) */
  retryDelay?: number;

  /** Timeout for exec() (ms) */
  timeout?: number;
}

/**
 * Base Node class - defines prep-exec-post logic and graph connections
 */
export abstract class Node<TStore = any, TPrepItem = any, TExecResult = any> {
  /** Node configuration */
  readonly config?: NodeConfig;

  /** Task-specific parameters */
  protected params: Params = {};

  /** Connected edges */
  private edges: Map<Action, Node> = new Map();

  constructor(config?: NodeConfig) {
    this.config = config;
  }

  /**
   * Prep: Read and preprocess data from store
   * MUST be async generator - yields items to process
   */
  abstract prep(store: TStore): AsyncGenerator<TPrepItem>;

  /**
   * Exec: Pure computation
   * MUST be async generator - yields results
   * Called once per item from prep
   * Receives store for reading (avoid writes)
   */
  abstract exec(store: TStore, item: TPrepItem): AsyncGenerator<TExecResult>;

  /**
   * Post: Write results and return next action
   * Async function (NOT generator) - returns action string
   */
  abstract post(
    store: TStore,
    prepItems: TPrepItem[],
    execResults: TExecResult[]
  ): Promise<Action>;

  /**
   * ExecFallback: Handle errors after retries exhausted
   */
  execFallback?(store: TStore, item: TPrepItem, error: Error): Promise<TExecResult>;

  /**
   * Connect this node to another via an action
   */
  connect(action: Action | Node, target?: Node): this {
    if (target === undefined) {
      // connect(node) - default edge
      this.edges.set('default', action as Node);
    } else {
      // connect('action', node) - named edge
      this.edges.set(action as Action, target);
    }
    return this;
  }

  /**
   * Get connected node for an action (internal API for runtime)
   */
  getEdge(action: Action): Node | undefined {
    return this.edges.get(action);
  }

  /**
   * Set parameters for this node
   */
  setParams(params: Params): this {
    this.params = { ...params };
    return this;
  }
}
```

### 3.2 Global Runtime Functions

The execution logic is separated from the Node class into global functions:

```typescript
/**
 * Run a node and follow the graph
 * @param node - Starting node to execute
 * @param store - Shared store
 */
export async function run<TStore>(node: Node<TStore>, store: TStore): Promise<void> {
  // 1. Execute prep - collect all items
  const prepItems: any[] = [];
  for await (const item of node.prep(store)) {
    prepItems.push(item);
  }

  // 2. Execute exec for each item - collect all results
  const execResults: any[] = [];
  for (const item of prepItems) {
    // Execute with retry logic
    const results = await executeWithRetry(node, store, item);
    execResults.push(...results);
  }

  // 3. Execute post
  const action = await node.post(store, prepItems, execResults);

  // 4. Follow edge if action is not null
  if (action !== null) {
    const nextNode = node.getEdge(action) || node.getEdge('default');
    if (nextNode) {
      await run(nextNode, store);
    }
  }
}

/**
 * Execute a node's exec method with retry logic
 * @param node - Node to execute
 * @param store - Shared store
 * @param item - Item from prep to process
 */
async function executeWithRetry<TStore, TPrepItem, TExecResult>(
  node: Node<TStore, TPrepItem, TExecResult>,
  store: TStore,
  item: TPrepItem
): Promise<TExecResult[]> {
  const maxRetries = node.config?.maxRetries ?? 1;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const results: TExecResult[] = [];
      for await (const result of node.exec(store, item)) {
        results.push(result);
      }
      return results;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // Last attempt failed
        if (node.execFallback) {
          const fallback = await node.execFallback(store, item, error as Error);
          return [fallback];
        }
        throw error;
      }
      // Wait before retry
      if (node.config?.retryDelay) {
        await new Promise(resolve => setTimeout(resolve, node.config.retryDelay));
      }
    }
  }
  throw new Error('Unreachable');
}
```

### 3.3 Namespace (Optional Organization)

```typescript
/**
 * Namespace for organizing nodes
 */
export class Namespace {
  private nodes: Map<string, Node> = new Map();
  private children: Map<string, Namespace> = new Map();

  constructor(public name: string) {}

  /**
   * Register a node
   */
  register(name: string, node: Node): this {
    this.nodes.set(name, node);
    return this;
  }

  /**
   * Get a node by name
   */
  get(name: string): Node | undefined {
    return this.nodes.get(name);
  }

  /**
   * Create child namespace
   */
  namespace(name: string): Namespace {
    const ns = new Namespace(name);
    this.children.set(name, ns);
    return ns;
  }

  /**
   * Execute a named node (uses global run function)
   */
  async execute(nodeName: string, store: any): Promise<void> {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new Error(`Node ${nodeName} not found in namespace ${this.name}`);
    }
    await run(node, store);
  }
}
```

---

## 4. API Usage Examples

### 4.1 Basic Node - Single Item (Still Uses Generators)

```typescript
import { Node, run } from 'microflow';

interface MyStore {
  query: string;
  result?: string;
}

class SummarizeNode extends Node<MyStore, string, string> {
  async *prep(store: MyStore) {
    // Even for single item, use generator
    yield store.query;
  }

  async *exec(store: MyStore, query: string) {
    // Call LLM and yield result
    const summary = await callLLM(`Summarize: ${query}`);
    yield summary;
  }

  async post(store: MyStore, queries: string[], summaries: string[]): Promise<Action> {
    // Write to store
    store.result = summaries[0];
    return 'default'; // Continue to next node
  }
}

// Usage
const node = new SummarizeNode({ maxRetries: 3 });
const store: MyStore = { query: 'Explain quantum computing' };
await run(node, store);
console.log(store.result);
```

### 4.2 Batch Processing - Multiple Items

```typescript
import { Node, run } from 'microflow';

interface DocStore {
  documents: string[];
  summaries?: string[];
}

class BatchSummarizeNode extends Node<DocStore, string, string> {
  async *prep(store: DocStore) {
    // Yield multiple items
    for (const doc of store.documents) {
      yield doc;
    }
  }

  async *exec(store: DocStore, doc: string) {
    // Process each document
    const summary = await callLLM(`Summarize in 10 words: ${doc}`);
    yield summary;
  }

  async post(store: DocStore, docs: string[], summaries: string[]): Promise<Action> {
    // Store all summaries
    store.summaries = summaries;
    return 'default';
  }
}

// Usage
const node = new BatchSummarizeNode();
const store: DocStore = {
  documents: ['Doc 1...', 'Doc 2...', 'Doc 3...']
};
await run(node, store);
console.log(store.summaries); // ['Summary 1', 'Summary 2', 'Summary 3']
```

### 4.3 Streaming with Generators

```typescript
interface ChatStore {
  query: string;
  response?: string;
}

class StreamingChatNode extends Node<ChatStore, { text: string }, { token: string }> {
  async *prep(store: ChatStore) {
    yield { text: store.query };
  }

  async *exec(store: ChatStore, item: { text: string }) {
    // Stream LLM tokens
    for await (const token of streamLLM(item.text)) {
      // Yield each token as it arrives
      yield { token };
      // Could also write to stdout here for real-time streaming
      process.stdout.write(token);
    }
  }

  async post(store: ChatStore, items, results): Promise<Action> {
    // Accumulate all tokens
    const fullResponse = results.map(r => r.token).join('');
    store.response = fullResponse;
    return null; // End
  }
}
```

### 4.4 Streaming Multiple Items with Tracking

```typescript
interface MultiStreamStore {
  queries: string[];
  responses?: Record<number, string>;
}

class MultiStreamNode extends Node<
  MultiStreamStore,
  { index: number; query: string },
  { index: number; token: string }
> {
  async *prep(store: MultiStreamStore) {
    // Yield each query with index
    for (let i = 0; i < store.queries.length; i++) {
      yield { index: i, query: store.queries[i] };
    }
  }

  async *exec(store: MultiStreamStore, item: { index: number; query: string }) {
    // Stream tokens with index to track which query they belong to
    for await (const token of streamLLM(item.query)) {
      yield { index: item.index, token };
    }
  }

  async post(store: MultiStreamStore, items, results): Promise<Action> {
    // Group results by index and accumulate
    const byIndex: Record<number, string> = {};
    for (const { index, token } of results) {
      byIndex[index] = (byIndex[index] || '') + token;
    }
    store.responses = byIndex;
    return 'default';
  }
}
```

### 4.5 Node-Centric Graph Building

```typescript
import { Node, run } from 'microflow';

interface AgentStore {
  query: string;
  context: string[];
  answer?: string;
}

// Decision node
class DecideNode extends Node<AgentStore, void, string> {
  async *prep(store: AgentStore) {
    yield; // No prep needed, just trigger exec
  }

  async *exec(store: AgentStore) {
    const decision = await callLLM(
      `Should I search or answer? Context: ${store.context.join('\n')}`
    );
    yield decision; // 'search' or 'answer'
  }

  async post(store: AgentStore, _, actions: string[]): Promise<Action> {
    return actions[0]; // Return 'search' or 'answer'
  }
}

// Search node
class SearchNode extends Node<AgentStore, string, string[]> {
  async *prep(store: AgentStore) {
    yield store.query;
  }

  async *exec(store: AgentStore, query: string) {
    const results = await webSearch(query);
    yield results;
  }

  async post(store: AgentStore, _, results: string[][]): Promise<Action> {
    store.context.push(...results[0]);
    return 'decide'; // Loop back to decide
  }
}

// Answer node
class AnswerNode extends Node<AgentStore, string, string> {
  async *prep(store: AgentStore) {
    const context = store.context.join('\n');
    yield `Answer: ${store.query}\nContext: ${context}`;
  }

  async *exec(store: AgentStore, prompt: string) {
    const answer = await callLLM(prompt);
    yield answer;
  }

  async post(store: AgentStore, _, answers: string[]): Promise<Action> {
    store.answer = answers[0];
    return null; // End execution
  }
}

// Build the graph by connecting nodes
const decide = new DecideNode();
const search = new SearchNode();
const answer = new AnswerNode();

decide.connect('search', search);  // decide --[search]--> search
decide.connect('answer', answer);  // decide --[answer]--> answer
search.connect('decide', decide);  // search --[decide]--> decide (loop)

// Execute
const store: AgentStore = {
  query: 'What is the weather in Tokyo?',
  context: []
};

await run(decide, store);
console.log(store.answer);
```

### 4.6 Chunking Large Documents

```typescript
interface ChunkStore {
  text: string;
  summary?: string;
}

class ChunkSummarizeNode extends Node<ChunkStore, string, string> {
  async *prep(store: ChunkStore) {
    // Split into chunks of 1000 chars
    for (let i = 0; i < store.text.length; i += 1000) {
      yield store.text.slice(i, i + 1000);
    }
  }

  async *exec(store: ChunkStore, chunk: string) {
    const summary = await callLLM(`Summarize: ${chunk}`);
    yield summary;
  }

  async post(store: ChunkStore, chunks, summaries: string[]): Promise<Action> {
    // Combine all chunk summaries
    store.summary = summaries.join(' ');
    return null;
  }
}
```

### 4.7 Async Prep with Pagination

```typescript
interface PaginatedStore {
  apiUrl: string;
  allItems?: any[];
}

class FetchPaginatedNode extends Node<PaginatedStore, any, any> {
  async *prep(store: PaginatedStore) {
    // Fetch paginated data
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(`${store.apiUrl}?page=${page}`);
      const data = await response.json();

      for (const item of data.items) {
        yield item; // Yield items as they arrive
      }

      hasMore = data.hasNext;
      page++;
    }
  }

  async *exec(store: PaginatedStore, item: any) {
    // Process each item
    const processed = await processItem(item);
    yield processed;
  }

  async post(store: PaginatedStore, items, results): Promise<Action> {
    store.allItems = results;
    return 'default';
  }
}
```

### 4.8 Conditional Branching and Loops

```typescript
interface RAGStore {
  query: string;
  docs: Document[];
  answer?: string;
  needsMoreContext: boolean;
}

class RetrieveNode extends Node<RAGStore, string, Document[]> {
  async *prep(store: RAGStore) {
    yield store.query;
  }

  async *exec(store: RAGStore, query: string) {
    const docs = await vectorDB.search(query, { limit: 3 });
    yield docs;
  }

  async post(store: RAGStore, _, results: Document[][]): Promise<Action> {
    store.docs = results[0];

    // Check if we have enough context
    if (store.docs.length < 2) {
      store.needsMoreContext = true;
      return 'expand'; // Need broader search
    }
    return 'generate'; // Enough context
  }
}

class ExpandSearchNode extends Node<RAGStore, string, Document[]> {
  async *prep(store: RAGStore) {
    yield store.query;
  }

  async *exec(store: RAGStore, query: string) {
    const docs = await vectorDB.search(query, { limit: 10, threshold: 0.5 });
    yield docs;
  }

  async post(store: RAGStore, _, results: Document[][]): Promise<Action> {
    store.docs = results[0];
    return 'generate';
  }
}

class GenerateNode extends Node<RAGStore, string, string> {
  async *prep(store: RAGStore) {
    const context = store.docs.map(d => d.text).join('\n');
    yield `Question: ${store.query}\n\nContext: ${context}`;
  }

  async *exec(store: RAGStore, prompt: string) {
    const answer = await callLLM(prompt);
    yield answer;
  }

  async post(store: RAGStore, _, answers: string[]): Promise<Action> {
    store.answer = answers[0];
    return null; // End
  }
}

const retrieve = new RetrieveNode();
const expand = new ExpandSearchNode();
const generate = new GenerateNode();

retrieve.connect('generate', generate);
retrieve.connect('expand', expand);
expand.connect(generate); // Default connection
```

### 4.9 Error Handling with execFallback

```typescript
class RobustLLMNode extends Node<MyStore, string, string> {
  async *prep(store: MyStore) {
    yield store.prompt;
  }

  async *exec(store: MyStore, prompt: string) {
    // Might fail
    const result = await callLLM(prompt);
    yield result;
  }

  async execFallback(store: MyStore, prompt: string, error: Error): Promise<string> {
    console.error('LLM call failed:', error);
    return 'I apologize, but I encountered an error.';
  }

  async post(store: MyStore, prompts, results: string[]): Promise<Action> {
    store.response = results[0];
    return 'default';
  }
}

const node = new RobustLLMNode({ maxRetries: 3, retryDelay: 1000 });
```

### 4.10 Using Namespaces

```typescript
import { Namespace } from 'microflow';

// Create namespace
const aiAgents = new Namespace('ai-agents');

// Register nodes
aiAgents.register('summarize', summarizeNode);
aiAgents.register('search', searchNode);
aiAgents.register('answer', answerNode);

// Create sub-namespace
const tools = aiAgents.namespace('tools');
tools.register('web-search', webSearchNode);
tools.register('calculator', calculatorNode);

// Execute by name
const store = { query: 'Hello' };
await aiAgents.execute('summarize', store);
```

---

## 5. Architecture Details

### 5.1 The prep-exec-post Pipeline

```
Flow Execution:
┌─────────────────────────────────────────────────────────┐
│ Node Execution                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. async *prep(store)                                  │
│     ├─ Read from shared store                          │
│     ├─ Can make async I/O calls                        │
│     ├─ Yield items to process                          │
│     └─ Collect all items into array                    │
│                                                         │
│  2. For each item: async *exec(item)                    │
│     ├─ Pure computation                                │
│     ├─ With retry logic                                │
│     ├─ NO store access                                 │
│     ├─ Yield result(s) - can be multiple per item      │
│     └─ Collect all results into array                  │
│                                                         │
│  3. async post(store, prepItems, execResults)           │
│     ├─ Receives arrays of items and results            │
│     ├─ Write to store                                  │
│     ├─ Side effects                                    │
│     └─ Return Action string (Promise)                  │
│                                                         │
│  4. Follow edge matching Action                         │
│     └─ Execute next node                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Why generators?**

- **Incremental processing**: Yield items/results as they're ready
- **Async I/O**: Native support for async operations (fetch, DB, file I/O)
- **Streaming**: Yield tokens/chunks in real-time
- **Memory efficiency**: Process large datasets without loading all at once
- **Consistent contract**: Same pattern for single/batch/streaming
- **Simple mental model**: No special cases or auto-detection

### 5.2 Execution Model

The global `run()` function orchestrates node execution:

```typescript
async function run<TStore>(node: Node<TStore>, store: TStore): Promise<void> {
  // 1. Prep phase - collect all items
  const prepItems: any[] = [];
  for await (const item of node.prep(store)) {
    prepItems.push(item);
  }

  // 2. Exec phase - process each item with retry, collect results
  const execResults: any[] = [];
  for (const item of prepItems) {
    const results = await executeWithRetry(node, store, item);
    execResults.push(...results); // Flatten results
  }

  // 3. Post phase - process results, get action
  const action = await node.post(store, prepItems, execResults);

  // 4. Follow edge
  if (action !== null) {
    const nextNode = node.getEdge(action) || node.getEdge('default');
    if (nextNode) {
      await run(nextNode, store); // Recursive call
    }
  }
}
```

### 5.3 Action-Based Flow Control

```typescript
// Example: Multi-path agent
class RouterNode extends Node {
  async *prep(store) {
    yield store.input;
  }

  async *exec(input) {
    const decision = await classify(input);
    yield decision; // 'search', 'calculate', 'answer', 'error'
  }

  async post(store, _, decisions: string[]): Promise<Action> {
    return decisions[0]; // Return action to follow
  }
}

const router = new RouterNode();
const search = new SearchNode();
const calc = new CalculatorNode();
const answer = new AnswerNode();
const errorHandler = new ErrorNode();

router.connect('search', search);
router.connect('calculate', calc);
router.connect('answer', answer);
router.connect('error', errorHandler);
router.connect(answer); // Default fallback

// The post() return value determines which edge to follow
```

### 5.4 Memory Model: Store vs Params

**Store (Heap-like)**
- Global, shared across all nodes
- Mutable
- Schema designed upfront
- For results and data

**Params (Stack-like)**
- Local to each node
- Immutable (by convention)
- Set by parent
- For task identifiers and context

```typescript
// Example: Params for tracking in batch
class ProcessWithContextNode extends Node {
  async *prep(store: MyStore) {
    const docId = this.params.docId; // From params
    const doc = store.documents.get(docId); // From store
    yield doc;
  }

  async *exec(doc: string) {
    const result = await process(doc);
    yield result;
  }

  async post(store: MyStore, docs, results): Promise<Action> {
    const docId = this.params.docId;
    store.results.set(docId, results[0]); // Write to store
    return 'default';
  }
}
```

### 5.5 Execution Flow Diagram

```
Start Node
    ↓
┌───────────────┐
│  prep() gen   │ ← Yield items
└───────┬───────┘
        ↓
  [item1, item2, ...]
        ↓
    For each item:
    ┌───────────┐
    │ exec() gen│ ← Yield results (with retry)
    └─────┬─────┘
          ↓
  [result1, result2, ...]
        ↓
┌───────────────┐
│   post()      │ ← Process all results, return Action
└───────┬───────┘
        ↓
     Action
        ↓
    ┌───┴────┐
    │ Edge?  │
    └───┬────┘
        ↓
    Yes → Next Node → (repeat)
    No  → End
```

### 5.6 Single vs Batch vs Streaming - Same Contract

```
Single Item:
  prep yields 1 item → exec yields 1 result → post gets [result]

Batch:
  prep yields N items → exec yields 1 result per item → post gets [r1, r2, ..., rN]

Streaming:
  prep yields 1 item → exec yields M tokens → post gets [t1, t2, ..., tM]

Batch + Streaming:
  prep yields N items → exec yields M tokens per item → post gets [all tokens]
  (implementer tracks which tokens belong to which item)
```

---

## 6. Open-Closed Architecture

### 6.1 Extension via Composition

```typescript
// Exponential backoff mixin
function withExponentialBackoff<T extends typeof Node>(Base: T) {
  return class extends Base {
    private async executeWithRetry(item: any) {
      const maxRetries = this.config?.maxRetries ?? 1;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const results = [];
          for await (const result of this.exec(item)) {
            results.push(result);
          }
          return results;
        } catch (error) {
          if (attempt === maxRetries - 1) throw error;

          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  };
}

// Usage
class MyNode extends withExponentialBackoff(Node) {
  async *prep(store) { yield store.data; }
  async *exec(data) { yield await callLLM(data); }
  async post(store, _, results) {
    store.result = results[0];
    return 'default';
  }
}
```

### 6.2 Middleware Pattern

With global `run()` function, middleware is implemented as wrapper functions:

```typescript
// Logging middleware wrapper
async function runWithLogging<TStore>(node: Node<TStore>, store: TStore): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting ${node.constructor.name}`);
  const start = Date.now();

  await run(node, store);

  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] Completed in ${duration}ms`);
}

// Usage
const myNode = new MyNode();
await runWithLogging(myNode, store);

// Or compose multiple middleware
async function runWithMiddleware<TStore>(
  node: Node<TStore>,
  store: TStore,
  ...middleware: Array<(next: () => Promise<void>) => Promise<void>>
): Promise<void> {
  let index = 0;
  const next = async (): Promise<void> => {
    if (index < middleware.length) {
      await middleware[index++](next);
    } else {
      await run(node, store);
    }
  };
  await next();
}
```

---

## 7. Comparison with PocketFlow

### What We Kept (The Good Parts ✅)

| Feature | Why It's Brilliant |
|---------|-------------------|
| prep-exec-post pipeline | Clean separation of I/O and computation |
| Action-based flow control | Elegant branching without complex DSL |
| Shared store | Simple, predictable state management |
| Node-centric connections | Intuitive graph building |
| Retry in exec only | Correct separation of concerns |
| Params for context | Stack-like task configuration |

### What We Unified & Simplified

| PocketFlow | MicroFlow | Benefit |
|------------|-----------|---------|
| Node, BatchNode, AsyncNode | **Single Node class** | Simpler mental model |
| Different signatures | **Consistent generator contract** | No special cases |
| Separate handling | **Auto-handles single/batch/streaming** | Same pattern everywhere |

### What We Adapted for TypeScript

| PocketFlow | MicroFlow | Reason |
|------------|-----------|---------|
| `>>` operator | `.connect()` | TypeScript doesn't have operator overloading |
| `node - "action" >> target` | `.connect('action', target)` | More TypeScript-friendly |
| Functions | **Async generators** | Native async/await + streaming |
| Python dict | TypeScript generics | Type-safe store |

### What We Added

- ✨ **Universal runtime**: Browser + Node.js support
- ✨ **Full type safety**: Generic types throughout
- ✨ **Generator-based**: Unified pattern for all use cases
- ✨ **Streaming built-in**: No separate node type needed
- ✨ **Better DX**: TypeScript autocomplete and type checking

---

## 8. Implementation Roadmap

### Phase 1: Core Implementation (~50 LOC)
- [ ] Base `Node` class with generator-based prep/exec
- [ ] Async post returning Promise<Action>
- [ ] `connect()` method for building graphs and `getEdge()` for runtime
- [ ] Global `run()` function for graph execution
- [ ] Global `executeWithRetry()` helper for retry logic

### Phase 2: Namespace & Organization
- [ ] `Namespace` class
- [ ] Node registration
- [ ] Named execution

### Phase 3: Advanced Features
- [ ] Timeout handling
- [ ] Better error messages
- [ ] Execution visualization
- [ ] Performance monitoring

### Phase 4: Testing & Documentation
- [ ] Unit tests for core
- [ ] Integration tests with mock LLM
- [ ] API documentation
- [ ] Example applications (RAG, Agent, Multi-agent)

---

## 9. Success Metrics

- **LOC**: Core implementation < 100 lines (Node class)
- **API Simplicity**: 1 core abstraction (Node) + 1 helper (Namespace)
- **Type Safety**: 100% TypeScript with generics
- **Bundle Size**: < 3KB minified + gzipped
- **Performance**: < 1ms overhead per node execution
- **DX**: IntelliSense autocomplete for all APIs
- **Flexibility**: Single/batch/streaming from same abstraction

---

## 10. Example: Complete RAG Application

```typescript
import { Node, run } from 'microflow';

// Define store schema
interface RAGStore {
  query: string;
  queryEmbedding?: number[];
  documents?: Array<{ id: string; text: string; score: number }>;
  context?: string;
  answer?: string;
}

// 1. Embed query
class EmbedQueryNode extends Node<RAGStore, string, number[]> {
  async *prep(store: RAGStore) {
    yield store.query;
  }

  async *exec(store: RAGStore, query: string) {
    const embedding = await embed(query);
    yield embedding;
  }

  async post(store: RAGStore, queries: string[], embeddings: number[][]): Promise<Action> {
    store.queryEmbedding = embeddings[0];
    return 'default';
  }
}

// 2. Retrieve documents
class RetrieveNode extends Node<RAGStore, number[], Document[]> {
  async *prep(store: RAGStore) {
    yield store.queryEmbedding!;
  }

  async *exec(store: RAGStore, embedding: number[]) {
    const docs = await vectorDB.search(embedding, { limit: 5 });
    yield docs;
  }

  async post(store: RAGStore, embeddings: number[][], docSets: Document[][]): Promise<Action> {
    store.documents = docSets[0];

    // Conditional: check quality
    const avgScore = store.documents.reduce((s, d) => s + d.score, 0) / store.documents.length;
    return avgScore > 0.7 ? 'generate' : 'expand';
  }
}

// 3. Expand search (if needed)
class ExpandSearchNode extends Node<RAGStore, number[], Document[]> {
  async *prep(store: RAGStore) {
    yield store.queryEmbedding!;
  }

  async *exec(store: RAGStore, embedding: number[]) {
    const docs = await vectorDB.search(embedding, { limit: 10, threshold: 0.5 });
    yield docs;
  }

  async post(store: RAGStore, embeddings: number[][], docSets: Document[][]): Promise<Action> {
    store.documents = docSets[0];
    return 'generate';
  }
}

// 4. Generate answer with streaming
class GenerateNode extends Node<RAGStore, string, string> {
  async *prep(store: RAGStore) {
    const context = store.documents!.map(d => d.text).join('\n\n');
    store.context = context;
    const prompt = `Answer the question based on the context.

Context:
${context}

Question: ${store.query}

Answer:`;
    yield prompt;
  }

  async *exec(prompt: string) {
    // Stream tokens in real-time
    for await (const token of streamLLM(prompt)) {
      process.stdout.write(token); // Show streaming
      yield token;
    }
  }

  async post(store: RAGStore, prompts, tokens: string[]): Promise<Action> {
    // Accumulate all tokens
    store.answer = tokens.join('');
    return null; // End execution
  }
}

// Instantiate nodes
const embedQuery = new EmbedQueryNode();
const retrieve = new RetrieveNode();
const expandSearch = new ExpandSearchNode();
const generate = new GenerateNode({ maxRetries: 3 });

// Build the graph
embedQuery.connect(retrieve);
retrieve.connect('generate', generate);
retrieve.connect('expand', expandSearch);
expandSearch.connect(generate);

// Execute
const store: RAGStore = {
  query: 'What is quantum entanglement?'
};

await run(embedQuery, store);
console.log('\nFinal answer:', store.answer);
```

---

## 11. Conclusion

MicroFlow brings PocketFlow's elegant design philosophy to TypeScript with a radical simplification:

### Core Innovation: One Node Type

**PocketFlow** has 3 node types:
- `Node` - basic execution
- `BatchNode` - iterate over collections
- `AsyncNode` - async operations

**MicroFlow** has 1 node type:
- `Node` with async generators - handles all cases

### The Generator Contract

```typescript
async *prep(store)              // Yield items (1 or many)
async *exec(item)               // Yield results (1 or many per item)
async post(store, items, results) // Return action
```

**Benefits:**
1. **Consistent** - Same pattern everywhere
2. **Flexible** - Single/batch/streaming from one abstraction
3. **Simple** - No auto-detection, no special cases
4. **Powerful** - Native async I/O and streaming support
5. **Predictable** - Clear contracts, easy to reason about

### TypeScript Enhancements

1. **Full type safety** with generics
2. **Class-based architecture** for extension via composition
3. **Universal runtime** (browser + Node.js)
4. **Better developer experience** with autocomplete
5. **Namespace** for organization

### Architecture Improvements

1. **Separation of Concerns**: Node defines logic, global `run()` handles execution
2. **Open-Closed Design**: Extend via composition (mixins, wrappers) without modifying Node
3. **Pure Class-Based**: No functional API overhead, just simple classes

### The Result

A **<100 line core** that handles single/batch/streaming with one unified abstraction, maintaining the elegance and simplicity that makes PocketFlow brilliant.

**Philosophy**: Copy the best ideas, unify through generators, separate concerns, keep it simple.
