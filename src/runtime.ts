import { Node } from './node';

async function executeWithRetry<TStore, TPrepItem, TExecResult>(
  node: Node<TStore, TPrepItem, TExecResult>,
  store: TStore,
  item: TPrepItem
): Promise<TExecResult> {
  const maxRetries = node.config.maxRetries;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await node.exec(store, item);
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // All retries exhausted
        if (node.execFallback) {
          return await node.execFallback(store, item, error as Error);
        }
        throw error;
      }

      const retryDelay = Math.max(node.config.retryDelay, 0)
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error('Unreachable');
}

export async function run<TStore>(node: Node<TStore>, store: TStore): Promise<void> {
  const prepItems: any[] = [];
  const execResults: any[] = [];
  const execPromises: Promise<void>[] = [];
  const generator = node.prep(store);

  let result = await generator.next();
  while (true) {
    if (result.done) break;

    let item = result.value instanceof Promise ? result.value : Promise.resolve(result.value);
    const execPromise = (async () => {
      prepItems.push(await item);

      const execValue = await executeWithRetry(node, store, await item);
      execResults.push(execValue);
    })();

    execPromises.push(execPromise);
    result = await generator.next(item);
  }

  await Promise.all(execPromises);

  // Execute post
  const action = await node.post(store, prepItems, execResults);

  // Traverse the graph
  if (action !== null) {
    const nextNode = node.getEdge(action) || node.getEdge('default');
    if (nextNode) {
      await run(nextNode, store);
    }
  }
}
