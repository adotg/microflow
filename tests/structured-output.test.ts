import { Node, run, Action } from '../src';
import { mockLLM } from './mock-llm';

/**
 * Structured Output Pattern: Reliable Formatting & Validation
 *
 * Ensures LLM responses follow consistent formats through three strategies:
 * prompting, schema enforcement, and post-processing. For modern LLMs, prompting
 * is simple and reliable.
 *
 * **How it works:**
 * 1. **Prompt Engineering**: Guide the LLM by wrapping desired structures in code
 *    fences (```yaml or ```json) and providing explicit formatting examples.
 *
 * 2. **Structured Parsing in exec**: Parse the LLM's response to extract structured
 *    data (e.g., YAML/JSON parsing). Return strongly-typed objects rather than strings.
 *
 * 3. **Validation in post**: Verify the response contains all required fields.
 *    MicroFlow's retry mechanism allows automatic retries if validation fails
 *    (throw an error, and the node will retry up to maxRetries times).
 *
 * **Why YAML over JSON:**
 * Current LLMs struggle with escaping characters in JSON strings. YAML avoids this
 * problem because:
 * - No need to escape interior quotes
 * - Block literals (|) naturally preserve newlines
 * - More forgiving syntax reduces parsing errors
 *
 * **Use cases:**
 * - Information extraction with defined schemas
 * - Document summarization with consistent structure
 * - Configuration file generation
 * - Any scenario requiring reliable, parseable LLM output
 *
 * **Implementation:**
 * Combine clear prompts with validation in post(). If validation fails, throw an
 * error to trigger automatic retry. This pattern leverages MicroFlow's built-in
 * retry mechanism for robust structured output.
 */

interface StructuredStore {
  text: string;
  extractedData?: PersonInfo;
}

interface PersonInfo {
  name: string;
  age: number;
  occupation: string;
}

class ExtractNode extends Node<StructuredStore, string, PersonInfo> {
  async *prep(store: StructuredStore) {
    const prompt = `Extract person information from the following text and output as YAML:
Text: ${store.text}

Output format:
\`\`\`yaml
name: <name>
age: <age>
occupation: <occupation>
\`\`\``;
    yield prompt;
  }

  async exec(store: StructuredStore, prompt: string): Promise<PersonInfo> {
    await mockLLM.call(prompt);

    return {
      name: 'John Doe',
      age: 30,
      occupation: 'Engineer'
    };
  }

  async post(
    store: StructuredStore,
    prepItems: string[],
    execResults: PersonInfo[]
  ): Promise<Action> {
    const data = execResults[0];

    if (!data.name || !data.age || !data.occupation) {
      throw new Error('Missing required fields');
    }

    store.extractedData = data;
    return null;
  }
}

describe('Structured Output Pattern', () => {
  test('extracts structured data with validation', async () => {
    const store: StructuredStore = {
      text: 'John Doe is a 30 year old engineer working at a tech company.'
    };

    const node = new ExtractNode();
    await run(node, store);

    expect(store.extractedData).toBeDefined();
    expect(store.extractedData!.name).toBe('John Doe');
    expect(store.extractedData!.age).toBe(30);
    expect(store.extractedData!.occupation).toBe('Engineer');
  });
});
