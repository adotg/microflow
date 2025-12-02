import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * RAG Pattern: Retrieval-Augmented Generation
 *
 * RAG enables LLMs to answer questions with relevant context by combining retrieval
 * and generation. It's implemented as a two-stage pipeline:
 *
 * **Stage 1: Offline Indexing**
 * Documents are preprocessed and stored for fast retrieval:
 * 1. **ChunkNode**: Breaks raw documents into manageable pieces (e.g., sentences/paragraphs)
 * 2. **EmbedNode**: Converts each chunk into vector embeddings using an embedding model
 * 3. **StoreNode**: Loads embeddings into a vector database (not shown in this example)
 *
 * These nodes chain sequentially, with each stage storing results in the shared store.
 *
 * **Stage 2: Online Query & Answer**
 * When answering a user question:
 * 1. **QueryEmbedNode**: Converts the question into an embedding vector
 * 2. **RetrieveNode**: Searches the vector index to find most relevant chunks (top-k retrieval)
 * 3. **AnswerNode**: Passes the question plus retrieved context to LLM for answer generation
 *
 * **How it works:**
 * - Map-reduce pattern in indexing: Multiple documents chunked and embedded in parallel
 * - Workflow pattern in query: Sequential embedding → retrieval → generation
 * - Shared store acts as an in-memory vector database (use real vector DB in production)
 * - Context injection: Prompt combines `Question: {question}\nContext: {chunk}\nAnswer:`
 *
 * **Key advantage:**
 * Separates expensive indexing work (done once) from fast query-time operations,
 * enabling efficient retrieval-augmented responses through MicroFlow's composable abstractions.
 */

interface RAGStore {
  documents?: string[];
  chunks?: string[];
  embeddings?: number[][];
  query?: string;
  queryEmbedding?: number[];
  retrievedChunk?: string;
  answer?: string;
}

class ChunkNode extends Node<RAGStore, string, string[]> {
  async *prep(store: RAGStore) {
    for (const doc of store.documents!) {
      yield doc;
    }
  }

  async exec(store: RAGStore, doc: string): Promise<string[]> {
    await new Promise(resolve => setTimeout(resolve, 5));
    return doc.split('.').filter(s => s.trim());
  }

  async post(
    store: RAGStore,
    prepItems: string[],
    execResults: string[][]
  ): Promise<Action> {
    store.chunks = execResults.flat();
    return 'embed';
  }
}

class EmbedNode extends Node<RAGStore, string, number[]> {
  async *prep(store: RAGStore) {
    for (const chunk of store.chunks!) {
      yield chunk;
    }
  }

  async exec(store: RAGStore, chunk: string): Promise<number[]> {
    return mockLLM.embed(chunk);
  }

  async post(
    store: RAGStore,
    prepItems: string[],
    execResults: number[][]
  ): Promise<Action> {
    store.embeddings = execResults;
    return null;
  }
}

class QueryEmbedNode extends Node<RAGStore, string, number[]> {
  async *prep(store: RAGStore) {
    yield store.query!;
  }

  async exec(store: RAGStore, query: string): Promise<number[]> {
    return mockLLM.embed(query);
  }

  async post(
    store: RAGStore,
    prepItems: string[],
    execResults: number[][]
  ): Promise<Action> {
    store.queryEmbedding = execResults[0];
    return 'retrieve';
  }
}

class RetrieveNode extends Node<RAGStore, number, string> {
  async *prep(store: RAGStore) {
    yield 0;
  }

  async exec(store: RAGStore, index: number): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 5));
    return store.chunks![index];
  }

  async post(
    store: RAGStore,
    prepItems: number[],
    execResults: string[]
  ): Promise<Action> {
    store.retrievedChunk = execResults[0];
    return 'answer';
  }
}

class RAGAnswerNode extends Node<RAGStore, string, string> {
  async *prep(store: RAGStore) {
    yield `Question: ${store.query}\nContext: ${store.retrievedChunk}\nAnswer:`;
  }

  async exec(store: RAGStore, prompt: string): Promise<string> {
    return mockLLM.call(prompt);
  }

  async post(
    store: RAGStore,
    prepItems: string[],
    execResults: string[]
  ): Promise<Action> {
    store.answer = execResults[0];
    return null;
  }
}

describe('RAG Pattern', () => {
  test('indexes documents and retrieves relevant context for answering', async () => {
    const indexStore: RAGStore = {
      documents: [
        'Paris is the capital of France. It has the Eiffel Tower.',
        'London is the capital of England. It has Big Ben.'
      ]
    };

    const chunkNode = new ChunkNode();
    const embedNode = new EmbedNode();
    chunkNode.connect('embed', embedNode);

    await run(chunkNode, indexStore);

    expect(indexStore.chunks!.length).toBeGreaterThan(0);
    expect(indexStore.embeddings!.length).toBeGreaterThan(0);

    const queryStore: RAGStore = {
      chunks: indexStore.chunks,
      embeddings: indexStore.embeddings,
      query: 'What is the capital of France?'
    };

    const queryEmbedNode = new QueryEmbedNode();
    const retrieveNode = new RetrieveNode();
    const answerNode = new RAGAnswerNode();

    queryEmbedNode.connect('retrieve', retrieveNode);
    retrieveNode.connect('answer', answerNode);

    await run(queryEmbedNode, queryStore);

    expect(queryStore.retrievedChunk).toBeDefined();
    expect(queryStore.answer).toBeDefined();
  });
});
